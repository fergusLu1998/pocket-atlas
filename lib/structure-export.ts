import type { RDKitModule } from '@rdkit/rdkit';
import type { jsPDF } from 'jspdf';
import type { Mol } from './chem';

type Candidate = Pick<Mol, 'key' | 'id' | 'smiles' | 'mw' | 'mmgbsa'>;
export const STRUCTURES_PER_PAGE = 12;
const WIDTH = 1240,
  HEIGHT = 1754,
  SCALE = 2;
const MARGIN = 60,
  GAP = 18;
const CARD_WIDTH = (WIDTH - MARGIN * 2 - GAP * 2) / 3;
const CARD_HEIGHT = (HEIGHT - MARGIN * 2 - GAP * 3) / 4;
const FONT = 'Arial, "Microsoft YaHei", sans-serif';

export function structurePages<T>(records: readonly T[]): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < records.length; i += STRUCTURES_PER_PAGE)
    pages.push(records.slice(i, i + STRUCTURES_PER_PAGE));
  return pages;
}

export function descriptorText(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(2)
    : '—';
}

function idLines(ctx: CanvasRenderingContext2D, text: string) {
  // Wrap by character so long catalogue IDs and CJK names remain complete.
  let lines: string[] = [];
  for (let size = 16; size >= 7; size--) {
    ctx.font = `600 ${size}px ${FONT}`;
    lines = [''];
    for (const character of text) {
      const last = lines.length - 1;
      if (
        lines[last] &&
        ctx.measureText(lines[last] + character).width > CARD_WIDTH - 40
      )
        lines.push(character);
      else lines[last] += character;
    }
    if (lines.length <= 3) return { lines, size };
  }
  throw Error('化合物 ID 过长，无法在结构图中完整显示。请缩短该 ID 后重试。');
}

async function svgImage(svg: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(Error('结构图加载失败。'));
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function drawPage(records: readonly Candidate[], rdkit: RDKitModule) {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * SCALE;
  canvas.height = HEIGHT * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw Error('浏览器无法生成结构图片。');
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const x = MARGIN + (i % 3) * (CARD_WIDTH + GAP);
    const y = MARGIN + Math.floor(i / 3) * (CARD_HEIGHT + GAP);
    ctx.strokeStyle = '#dce2e6';
    ctx.lineWidth = 0.7;
    ctx.strokeRect(x, y, CARD_WIDTH, CARD_HEIGHT);
    ctx.fillStyle = '#25323b';
    const label = idLines(ctx, `ID: ${record.id}`);
    label.lines.forEach((line, index) =>
      ctx.fillText(line, x + 20, y + 28 + index * (label.size + 3)),
    );
    const mol = rdkit.get_mol(record.smiles);
    if (!mol || !mol.is_valid()) {
      mol?.delete();
      throw Error(`无法绘制化合物 ${record.id} 的结构。`);
    }
    let svg: string;
    try {
      svg = mol.get_svg(
        Math.round(CARD_WIDTH - 32),
        Math.round(CARD_HEIGHT - 140),
      );
    } finally {
      mol.delete();
    }
    const image = await svgImage(svg);
    ctx.drawImage(image, x + 16, y + 82, CARD_WIDTH - 32, CARD_HEIGHT - 140);
    ctx.font = `13px ${FONT}`;
    ctx.fillStyle = '#25323b';
    ctx.fillText(
      `MW: ${descriptorText(record.mw)} g/mol`,
      x + 20,
      y + CARD_HEIGHT - 36,
    );
    ctx.fillText(
      `MM/GBSA: ${descriptorText(record.mmgbsa)} kcal/mol`,
      x + 20,
      y + CARD_HEIGHT - 16,
    );
  }
  return canvas;
}

export async function createStructureExport(
  records: readonly Candidate[],
  format: 'pdf' | 'png',
  rdkit: RDKitModule,
  onProgress: (completed: number, total: number) => void = () => {},
) {
  if (!records.length) throw Error('请先勾选初筛候选分子。');
  const pages = structurePages(records);
  onProgress(0, pages.length);
  await document.fonts.ready;
  let pdf: jsPDF | undefined;
  let zip: import('fflate').Zip | undefined;
  let zipFile: typeof import('fflate').ZipPassThrough | undefined;
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let zipError: Error | null = null;
  if (format === 'pdf') {
    const { jsPDF } = await import('jspdf');
    pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  } else if (pages.length > 1) {
    const { Zip, ZipPassThrough } = await import('fflate');
    zipFile = ZipPassThrough;
    zip = new Zip((error, data) => {
      if (error) zipError = error;
      else chunks.push(new Uint8Array(data));
    });
  }
  let singlePng: Blob | undefined;
  for (let page = 0; page < pages.length; page++) {
    const canvas = await drawPage(pages[page], rdkit);
    try {
      if (pdf) {
        if (page) pdf.addPage();
        pdf.addImage(
          canvas.toDataURL('image/jpeg', 0.98),
          'JPEG',
          0,
          0,
          210,
          297,
        );
      } else {
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (result) =>
              result ? resolve(result) : reject(Error('PNG 编码失败。')),
            'image/png',
          ),
        );
        if (zip && zipFile) {
          const file = new zipFile(
            `candidates_${String(page + 1).padStart(3, '0')}.png`,
          );
          zip.add(file);
          file.push(new Uint8Array(await blob.arrayBuffer()), true);
          if (zipError) throw zipError;
        } else singlePng = blob;
      }
    } finally {
      canvas.width = canvas.height = 0;
    }
    onProgress(page + 1, pages.length);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (pdf)
    return { blob: pdf.output('blob'), extension: 'pdf', pages: pages.length };
  if (zip) {
    zip.end();
    if (zipError) throw zipError;
    return {
      blob: new Blob(chunks, { type: 'application/zip' }),
      extension: 'zip',
      pages: pages.length,
    };
  }
  return { blob: singlePng!, extension: 'png', pages: 1 };
}

export function downloadStructureBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
