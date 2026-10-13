/* oxlint-disable no-control-regex -- Control characters are intentionally removed from exported filenames. */
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import {
  Download,
  FileText,
  Image as ImageIcon,
  RotateCcw,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Cluster, Mol } from '@/lib/chem';
import {
  createScaffoldExport,
  downloadStructureBlob,
  type ScaffoldSheetCard,
} from '@/lib/structure-export';

type Core = {
  coreSmiles: string;
  templateSmiles: string;
  svg: string;
  count: number;
  status: 'single' | 'variable' | 'constant' | 'unresolved';
  limited: boolean;
  acyclic: boolean;
  groups: {
    labels: string[];
    variants: number;
    values: { smiles: string; count: number }[];
  }[];
};
type Summary = {
  clusterId: number;
  total: number;
  mode: 'shared' | 'series' | 'error';
  cores: Core[];
  disconnected?: number;
  error?: string;
};
const clusterName = (id: number) => `Cluster ${String(id).padStart(2, '0')}`;
function coreNote(core: Core) {
  if (core.status === 'single') return '单一规范结构，无已确认的变异位点';
  if (core.status === 'constant')
    return '当前成员的连接结构一致，无变异 R 位点';
  if (core.status === 'unresolved') return '取代连接未能统一，按结构分别展示';
  return `变化位点：${core.groups.flatMap((g) => g.labels).join('、')}`;
}
function sheetCards(summaries: Summary[]): ScaffoldSheetCard[] {
  return summaries.flatMap((s) =>
    s.cores.length
      ? s.cores.map((core, i) => ({
          id:
            clusterName(s.clusterId) +
            (s.cores.length > 1 ? ` · 系列 ${i + 1}` : ''),
          svg: core.svg,
          lines: [
            `覆盖：${core.count} / ${s.total} 个分子`,
            core.groups.length
              ? `变异 R 位点：${core.groups.flatMap((g) => g.labels).length} 个`
              : '无已确认的变异 R 位点',
            s.mode === 'series'
              ? '簇内骨架子系列'
              : core.acyclic
                ? '无环共同连接结构'
                : '全簇共同连接骨架',
          ],
        }))
      : [
          {
            id: clusterName(s.clusterId),
            svg: '',
            lines: [`成员：${s.total} 个分子`, '共同骨架未生成，请复核'],
          },
        ],
  );
}

export function ClusterScaffoldDialog({
  rows,
  clusters,
  openCluster,
  onClose,
  dataset,
  isDemo,
}: {
  rows: Mol[];
  clusters: Cluster[];
  openCluster: number | 'all' | null;
  onClose: () => void;
  dataset: string;
  isDemo: boolean;
}) {
  const [summaries, setSummaries] = useState<Record<number, Summary>>({});
  const cache = useRef<Record<number, Summary>>({}),
    worker = useRef<Worker | null>(null);
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(''),
    [error, setError] = useState('');
  const [retry, setRetry] = useState(0),
    [exporting, setExporting] = useState(false),
    [exportStatus, setExportStatus] = useState('');
  const wanted = useMemo(
    () =>
      clusters
        .filter((c) => openCluster === 'all' || c.id === openCluster)
        .sort((a, b) => a.id - b.id),
    [clusters, openCluster],
  );
  useEffect(() => {
    worker.current?.terminate();
    cache.current = {};
    setSummaries({});
    setError('');
    setExportStatus('');
  }, [rows, clusters]);
  useEffect(() => {
    if (openCluster === null) return;
    setExportStatus('');
    setError('');
    const missing = wanted.filter((c) => !cache.current[c.id]);
    if (!missing.length) {
      setBusy(false);
      return;
    }
    const w = new Worker('/scaffold-worker.js');
    worker.current = w;
    let active = true;
    setBusy(true);
    setProgress(`正在生成骨架：0 / ${missing.length} 个簇`);
    w.onmessage = (event) => {
      if (!active) return;
      const data = event.data;
      if (data.type === 'result') {
        cache.current = {
          ...cache.current,
          [data.summary.clusterId]: data.summary,
        };
        setSummaries(cache.current);
      } else if (data.type === 'progress')
        setProgress(`正在生成骨架：${data.completed} / ${data.total} 个簇`);
      else if (data.type === 'complete') {
        setBusy(false);
        setProgress('');
        w.terminate();
      } else if (data.type === 'error') {
        setError(data.message || '骨架计算未完成，请重试。');
        setBusy(false);
        w.terminate();
      }
    };
    w.onerror = () => {
      if (active) {
        setError('骨架分析引擎加载失败，请重试。');
        setBusy(false);
      }
      w.terminate();
    };
    w.postMessage({
      clusters: missing.map((c) => ({
        id: c.id,
        rows: c.members.map((i) => rows[i]),
      })),
    });
    return () => {
      active = false;
      w.terminate();
    };
  }, [openCluster, wanted, rows, retry]);
  const visible = wanted.map((c) => summaries[c.id]).filter(Boolean);
  const ready = visible.length === wanted.length && wanted.length > 0 && !busy;
  function retryFailed() {
    const next = { ...cache.current };
    for (const c of wanted) if (next[c.id]?.mode === 'error') delete next[c.id];
    cache.current = next;
    setSummaries(next);
    setRetry((v) => v + 1);
  }
  async function exportCores(format: 'pdf' | 'png') {
    setExporting(true);
    setExportStatus('正在生成骨架汇总…');
    try {
      const cards = sheetCards(visible);
      const result = await createScaffoldExport(cards, format, (done, total) =>
        setExportStatus(`正在导出：${done} / ${total} 页`),
      );
      const name =
        dataset.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 80) ||
        'PocketAtlas';
      downloadStructureBlob(
        `${isDemo ? 'DEMO_' : ''}${name}_簇骨架_${openCluster === 'all' ? visible.length : clusterName(Number(openCluster)).replace(' ', '_')}.${result.extension}`,
        result.blob,
      );
      setExportStatus(
        `已导出 ${visible.length} 个簇 · ${cards.length} 张汇总图 · ${result.pages} 页${result.extension === 'zip' ? ' PNG（ZIP）' : ''}`,
      );
    } catch (e) {
      setExportStatus(
        e instanceof Error ? e.message : '骨架汇总导出失败，请重试。',
      );
    } finally {
      setExporting(false);
    }
  }
  return (
    <Dialog
      open={openCluster !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className={`scaffold-dialog${openCluster === 'all' ? ' scaffold-overview' : ' scaffold-single'}`}
      >
        <DialogHeader>
          <DialogTitle>
            {openCluster === 'all'
              ? '簇骨架总览'
              : openCluster === null
                ? '簇共同骨架'
                : `${clusterName(openCluster)} · 共同骨架`}
          </DialogTitle>
          <DialogDescription>
            保留共同连接核心和固定侧链，用 R1、R2 标记变化侧链；R 也可取
            H。不同骨架无法统一时按子系列展示。
          </DialogDescription>
        </DialogHeader>
        <div className="scaffold-toolbar">
          <button
            className="btn secondary small"
            disabled={!ready || exporting}
            onClick={() => exportCores('pdf')}
          >
            <FileText size={16} />
            骨架 PDF
            <Download size={14} />
          </button>
          <button
            className="btn secondary small"
            disabled={!ready || exporting}
            onClick={() => exportCores('png')}
          >
            <ImageIcon size={16} />
            骨架 PNG
            <Download size={14} />
          </button>
          <span className="micro">
            {wanted.length} 个簇 · A4 每页 12 图 · 多页 PNG 打包 ZIP
          </span>
        </div>
        {(busy || exportStatus) && (
          <p role="status" aria-live="polite" className="micro">
            {exportStatus || progress}
          </p>
        )}
        {error && (
          <p role="alert" className="scaffold-error">
            {error}
          </p>
        )}
        {(error || visible.some((s) => s.mode === 'error')) && (
          <button
            className="btn secondary small"
            disabled={busy}
            onClick={retryFailed}
          >
            <RotateCcw size={14} />
            重试未完成骨架
          </button>
        )}
        <div className="scaffold-summaries">
          {wanted.map((c) => {
            const summary = summaries[c.id];
            return (
              <section
                key={c.id}
                className={`scaffold-cluster${summary && summary.cores.length > 1 ? ' scaffold-cluster-multiple' : ''}`}
              >
                <div className="scaffold-cluster-heading">
                  <b>{clusterName(c.id)}</b>
                  <span>{c.size} 个分子</span>
                </div>
                {!summary ? (
                  <p className="micro">正在核验共同核心…</p>
                ) : summary.mode === 'error' ? (
                  <p className="scaffold-error">
                    {summary.error || '该簇的骨架未能生成，请重试或核对结构。'}
                  </p>
                ) : (
                  <>
                    <p className="micro">
                      {summary.mode === 'shared'
                        ? `共同核心覆盖 ${summary.total} / ${summary.total} 个分子。`
                        : `未找到可覆盖全簇并直接 R 化的单一核心；以下 ${summary.cores.length} 个骨架子系列覆盖全部 ${summary.total} 个分子。原聚类不变。`}
                    </p>
                    <div className="scaffold-cards">
                      {summary.cores.map((core, i) => (
                        <article
                          className="scaffold-card"
                          key={`${core.coreSmiles}-${i}`}
                        >
                          <div className="scaffold-card-heading">
                            <b>
                              {summary.cores.length > 1
                                ? `骨架系列 ${i + 1}`
                                : '共同骨架'}
                            </b>
                            <span>
                              {core.count} / {summary.total}
                            </span>
                          </div>
                          <Image
                            unoptimized
                            width={560}
                            height={350}
                            src={
                              'data:image/svg+xml;charset=utf-8,' +
                              encodeURIComponent(core.svg)
                            }
                            alt={`${clusterName(c.id)} 骨架 ${i + 1}，${coreNote(core)}`}
                          />
                          <p className="micro">{coreNote(core)}</p>
                          {core.acyclic && (
                            <p className="micro">
                              无环结构：按实际共同连接片段展示。
                            </p>
                          )}
                          {core.limited && (
                            <p className="micro">
                              对称匹配较多，位点对齐采用有限搜索，请复核编号。
                            </p>
                          )}
                          {core.groups.length > 0 && (
                            <details className="scaffold-rgroups">
                              <summary>R 位点变化明细</summary>
                              {core.groups.map((group) => (
                                <div key={group.labels.join('/')}>
                                  <b>
                                    {group.labels.join('/')} · {group.variants}{' '}
                                    种组合
                                  </b>
                                  {group.labels.length > 1 && (
                                    <p className="micro">
                                      同一原子上的联合变化位点，不定义独立配对。
                                    </p>
                                  )}
                                  <ul>
                                    {group.values.map((v) => (
                                      <li key={v.smiles}>
                                        <code>
                                          {v.smiles === 'H'
                                            ? 'H（氢）'
                                            : v.smiles}
                                        </code>
                                        <span>{v.count} 个</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ))}
                            </details>
                          )}
                        </article>
                      ))}
                    </div>
                    {!!summary.disconnected && (
                      <p className="micro">
                        {summary.disconnected}{' '}
                        条记录含未连接片段；盐或溶剂片段不作为 R 基团。
                      </p>
                    )}
                  </>
                )}
              </section>
            );
          })}
        </div>
        <details className="scaffold-method">
          <summary>共同骨架的判定方式</summary>
          <p>
            在簇内实际 Murcko
            骨架候选中，优先选择能通过全部成员子结构匹配的较大核心，并比较相连侧链。固定侧链保留，变化侧链用
            R
            表示。无环分子以实际结构作为候选；单一结构只显示骨架，不推断变异。这不是穷举最大共同子结构搜索，二维连接图不用于判断共同立体构型或同位素标记。R
            编号仅在当前骨架内有效。
          </p>
        </details>
      </DialogContent>
    </Dialog>
  );
}
