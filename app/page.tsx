'use client';
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  Atom,
  Upload,
  Download,
  Layers3,
  Network,
  ShoppingBag,
  Database,
  Search,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Play,
  Save,
  Info,
  X,
  Check,
  Plus,
  Ban,
  RotateCcw,
  ArrowUpRight,
  FileText,
  FlaskConical,
  AlertTriangle,
  FolderOpen,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from '@/components/ui/pagination';
import {
  Structure,
  parseMaestro,
  parsePDB,
  parseSDF,
  readStructureFile,
  toMolBlock,
} from '@/lib/structures';
import {
  EngineConnection,
  InteractionResult,
  discoverLocalEngine,
  engineRequest,
  calculateInteractions,
} from '@/lib/local-engine';
import {
  interactionKey,
  residueKey,
  residueInteractionState,
  interactionKinds,
} from '@/lib/interactions';
import { ComplexViewer } from '@/components/complex-viewer';
import {
  StoredProject,
  getProject,
  listProjects,
  putProject,
} from '@/lib/project-store';
import { restoreDirectory, chooseDirectory, directoryName, directoryPermission, scanProjects } from '@/lib/project-directory';
import { getRDKit, Molecule, Scatter, color } from '@/components/chem-views';
import {
  Mol,
  Cluster,
  Issue,
  InputRow,
  Parsed,
  Mapping,
  parseInput,
  makeRecords,
  compareLogP,
  similarity,
  chooseCandidate,
  selectCandidatePage,
  download,
  csv,
  demo,
} from '@/lib/chem';

const fmt = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined ? '—' : v.toFixed(d);
function scoreProperty(
  properties: Record<string, string>,
  type: 'docking' | 'mmgbsa',
) {
  const normalized = Object.entries(properties).map(([key, value]) => ({
    key,
    value,
    normalized: key.toLowerCase().replace(/[^a-z0-9]+/g, ''),
  }));
  const exact =
    type === 'mmgbsa'
      ? ['rpspmmgbsadgbind', 'rpspprimemmgbsadgbind', 'mmgbsadgbind', 'mmgbsa']
      : ['ridockingscore', 'riglidegscore', 'dockingscore', 'docking'];
  const match =
    exact
      .map((name) => normalized.find((item) => item.normalized === name))
      .find(Boolean) ||
    normalized.find((item) =>
      type === 'mmgbsa'
        ? item.normalized.includes('mmgbsa') &&
          (item.normalized.includes('dgbind') ||
            item.normalized.endsWith('score'))
        : item.normalized.includes('dockingscore') ||
          item.normalized.includes('glidegscore'),
    );
  return { value: match?.value || '', key: match?.key || '' };
}
function Choice({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  label: string;
}) {
  return (
    <Select
      value={value || '__none'}
      onValueChange={(v) => onChange(v === '__none' ? '' : String(v))}
    >
      <SelectTrigger aria-label={label} className="choice">
        <SelectValue>
          {options.find(([v]) => v === (value || '__none'))?.[1] || label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map(([value, label]) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
type Restore = {
  selected?: string[];
  excluded?: string[];
  notes?: Record<string, string>;
};
type Retention = {
  limit: number;
  rank: 'mmgbsa' | 'docking' | 'source';
} | null;
export default function Home() {
  const [projectId, setProjectId] = useState('project-' + Date.now()),
    [projects, setProjects] = useState<StoredProject[]>([]),
    [lastSavedAt, setLastSavedAt] = useState<string | null>(null),
    [hasUnsaved, setHasUnsaved] = useState(false);
  const [projectNotes, setProjectNotes] = useState('');
  const [directoryLabel, setDirectoryLabel] = useState('');
  const [directoryStatus, setDirectoryStatus] = useState('尚未指定项目目录');
  const [directoryWarnings, setDirectoryWarnings] = useState<string[]>([]);
  const [directoryBusy, setDirectoryBusy] = useState(false);
  const [closedIds, setClosedIds] = useState<string[]>([]);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [workspaceEmpty, setWorkspaceEmpty] = useState(false);
  const [closeTarget, setCloseTarget] = useState<string | null>(null);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [metadataName, setMetadataName] = useState('');
  const [metadataNotes, setMetadataNotes] = useState('');
  const [pendingMetadataSave, setPendingMetadataSave] = useState(false);
  const saveLock = useRef(false);
  const savedProjectId = useRef('');
  const initializedDemo = useRef(false);
  const suppressDirty = useRef(true);
  const dirtyVersion = useRef(0);
  const [rows, setRows] = useState<Mol[]>([]),
    [allRows, setAllRows] = useState<Mol[]>([]),
    [clusters, setClusters] = useState<Cluster[]>([]),
    [issues, setIssues] = useState<Issue[]>([]),
    [warnings, setWarnings] = useState<string[]>([]),
    [records, setRecords] = useState<InputRow[]>([]);
  const [raw, setRaw] = useState(demo),
    [mapping, setMapping] = useState<Mapping>({
      id: 'id',
      smiles: 'smiles',
      docking: 'docking',
      mmgbsa: 'mmgbsa',
      supplier: 'supplier',
      catalog: 'catalog_id',
    }),
    [dataset, setDataset] = useState('演示化合物库'),
    [isDemo, setIsDemo] = useState(true);
  const [selected, setSelected] = useState<string[]>([]),
    [excluded, setExcluded] = useState<string[]>([]),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [active, setActive] = useState<string | null>(null);
  const [connection, setConnection] = useState<EngineConnection | null>(null),
    [engineStatus, setEngineStatus] = useState('未连接'),
    [viewOpen, setViewOpen] = useState(false),
    [interactionCache, setInteractionCache] = useState<
      Record<string, InteractionResult>
    >({});
  const receptorFile = useRef<HTMLInputElement>(null);
  const [poses, setPoses] = useState<Record<string, Structure>>({}),
    [receptors, setReceptors] = useState<Structure[]>([]),
    [receptorIndex, setReceptorIndex] = useState(0),
    [viewPose, setViewPose] = useState<Structure | null>(null);
  const [basis, setBasis] = useState('molecule');
  const [retainCount, setRetainCount] = useState('500'),
    [retainRank, setRetainRank] = useState<'mmgbsa' | 'docking' | 'source'>(
      'mmgbsa',
    );
  const [residueQuery, setResidueQuery] = useState(''),
    [interactionMode, setInteractionMode] = useState('all'),
    [interactionType, setInteractionType] = useState('all'),
    [residueMatch, setResidueMatch] = useState('any'),
    [batchProgress, setBatchProgress] = useState(''),
    [batchBusy, setBatchBusy] = useState(false);
  const batchStop = useRef(false);
  const [radius, setRadius] = useState(2),
    [nBits, setNBits] = useState(2048);
  const [threshold, setThreshold] = useState(0.6),
    [chirality, setChirality] = useState(false),
    [applied, setApplied] = useState({
      threshold: 0.6,
      chirality: false,
      radius: 2,
      nBits: 2048,
      basis: 'molecule',
      retention: null as Retention,
    }),
    [version, setVersion] = useState('');
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [stage, setStage] = useState(''),
    [message, setMessage] = useState('');
  const worker = useRef<Worker | null>(null);
  const [importOpen, setImportOpen] = useState(false),
    [methodsOpen, setMethodsOpen] = useState(false),
    [qualityOpen, setQualityOpen] = useState(false),
    [exportOpen, setExportOpen] = useState(false);
  const [draft, setDraft] = useState(''),
    [draftName, setDraftName] = useState('我的化合物库'),
    [parsed, setParsed] = useState<Parsed | null>(null),
    [draftMap, setDraftMap] = useState<Mapping | null>(null);
  const [query, setQuery] = useState(''),
    [clusterFilter, setClusterFilter] = useState<number | null>(null),
    [statusFilter, setStatusFilter] = useState('all'),
    [sort, setSort] = useState('mmgbsa'),
    [maxDock, setMaxDock] = useState(''),
    [maxGBSA, setMaxGBSA] = useState(''),
    [region, setRegion] = useState<string[] | null>(null),
    [page, setPage] = useState(0),
    [chart, setChart] = useState<'map' | 'scores'>('map');
  const [pageSize, setPageSize] = useState(20);
  const [candidateLimit, setCandidateLimit] = useState<number | null>(null);
  const projectFile = useRef<HTMLInputElement>(null);

  const refreshProjects = useCallback(async () => {
    try {
      if (directoryName()) {
        const result = await scanProjects();
        setProjects(result.entries); setDirectoryWarnings(result.warnings);
        setDirectoryStatus('已检索 ' + result.entries.length + ' 个项目文件');
      } else setProjects(await listProjects());
    } catch (e) {
      setDirectoryStatus((e as Error).message);
    }
  }, []);

  const connectLocalSchrodinger = useCallback(async (notify = false) => {
    try {
      const c = await discoverLocalEngine();
      setConnection((old) => (old?.token === c.token ? old : c));
      setEngineStatus('Schrödinger 已自动连接');
      if (notify) setMessage('已检索到本机 Schrödinger，原生结构与互作分析已启用。');
      return true;
    } catch {
      setConnection(null);
      setEngineStatus('未检测到 Schrödinger');
      if (notify)
        setMessage(
          '未检测到本机 Schrödinger。分子聚类可直接使用；需要原生结构与互作分析时，请下载并运行 Pocket Atlas 启动器。',
        );
      return false;
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try { setDirectoryLabel(await restoreDirectory()); await refreshProjects(); }
      catch (e) { setDirectoryStatus((e as Error).message); }
    })();
    let checking = false,
      alive = true;
    const reconnect = async () => {
      if (checking) return;
      checking = true;
      try {
        const c = await discoverLocalEngine();
        if (!alive) return;
        setConnection((old) => (old?.token === c.token ? old : c));
        setEngineStatus('Schrödinger 已自动连接');
      } catch {
        if (alive) {
          setConnection(null);
          setEngineStatus('未检测到 Schrödinger');
        }
      } finally {
        checking = false;
      }
    };
    void reconnect();
    const poll = window.setInterval(() => {
      void reconnect();
    }, 5000);
    const ready = window.setTimeout(() => {
      suppressDirty.current = false;
    }, 1500);
    return () => {
      alive = false;
      window.clearTimeout(ready);
      window.clearInterval(poll);
    };
  }, [refreshProjects]);

  useEffect(() => {
    dirtyVersion.current++;
    if (!suppressDirty.current) setHasUnsaved(true);
  }, [
    raw,
    projectNotes,
    candidateLimit,
    pageSize,
    selected,
    excluded,
    notes,
    applied,
    poses,
    receptors,
    receptorIndex,
    interactionCache,
  ]);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!hasUnsaved) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [hasUnsaved]);
  const run = useCallback(function run(
    input: InputRow[],
    config: {
      threshold: number;
      chirality: boolean;
      radius: number;
      nBits: number;
      basis: string;
      retention?: Retention;
    },
    context?: {
      text: string;
      map: Mapping;
      name: string;
      demo: boolean;
      warnings: string[];
      restore?: Restore;
    },
  ) {
    worker.current?.terminate();
    const w = new Worker('/chem-worker.js');
    worker.current = w;
    setBusy(true);
    setProgress(0);
    setStage('准备分析');
    setMessage('');
    w.onmessage = (e) => {
      const data = e.data;
      if (data.type === 'progress') {
        setProgress(data.value);
        setStage(data.message);
      } else if (data.type === 'error') {
        setMessage('分析失败：' + data.message);
        setBusy(false);
        w.terminate();
      } else if (data.type === 'result') {
        const results = data.rows as Mol[];
        const complete = (data.allRows || results) as Mol[];
        setAllRows(complete);
        setRows(results);
        setRevision((v) => v + 1);
        setClusters(data.clusters);
        setIssues(data.issues);
        setApplied({ ...config, retention: config.retention || null });
        setVersion(data.version);
        setRecords(input);
        setRegion(null);
        setClusterFilter(null);
        setPage(0);
        if (context) {
          setRaw(context.text);
          setMapping(context.map);
          setDataset(context.name);
          setWorkspaceEmpty(false);
          if (!context.demo && !context.restore && results.length) {
            setProjectId('project-' + crypto.randomUUID());
            setProjectNotes(''); setInteractionCache({});
            setLastSavedAt(null); setHasUnsaved(true);
            setMetadataName(context.name); setMetadataNotes('');
            setCreatingProject(true); setMetadataOpen(true);
          }
          setIsDemo(context.demo);
          setWarnings(context.warnings);
          setQuery('');
          setStatusFilter('all');
          setMaxDock('');
          setMaxGBSA('');
          const keep: string[] = [];
          const canonical = new Set<string>();
          for (const key of context.restore?.selected || []) {
            const r = complete.find((r) => r.key === key);
            if (r && !canonical.has(r.canonical) ) {
              keep.push(key);
              canonical.add(r.canonical);
            }
          }
          setSelected(keep);
          setExcluded(
            (context.restore?.excluded || []).filter(
              (k) => complete.some((r) => r.key === k) && !keep.includes(k),
            ),
          );
          setNotes(context.restore?.notes || {});
          setActive(results[0]?.key || null);
          setImportOpen(false);
        } else
          setActive((previous) =>
            results.some((r) => r.key === previous)
              ? previous
              : results[0]?.key || null,
          );
        setBusy(false);
        setProgress(100);
        w.terminate();
        if (!results.length)
          setMessage('未获得有效分子，请打开数据检查查看原因。');
      }
    };
    w.onerror = () => {
      setBusy(false);
      setMessage('分析引擎未能完成运行，请重试或减少单次数据量。');
      w.terminate();
    };
    w.postMessage({ records: input, ...config });
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (initializedDemo.current) return;
      initializedDemo.current = true;
      const p = parseInput(demo),
        made = makeRecords(p, p.mapping);
      run(
        made.records,
        {
          threshold: 0.6,
          chirality: false,
          radius: 2,
          nBits: 2048,
          basis: 'molecule',
        },
        {
          text: demo,
          map: p.mapping,
          name: '演示化合物库',
          demo: true,
          warnings: made.warnings,
        },
      );
    }, 0);
    return () => {
      clearTimeout(timer);
      worker.current?.terminate();
    };
  }, [run]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const current = rows.find((r) => r.key === active) || null;
  const regionSet = useMemo(() => (region ? new Set(region) : null), [region]);
  const baseFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter(
        (r) =>
          (clusterFilter === null || r.cluster === clusterFilter) &&
          (!regionSet || regionSet.has(r.key)) &&
          (!q ||
            [r.id, r.smiles, r.canonical, r.supplier, r.catalog].some((v) =>
              v.toLowerCase().includes(q),
            )) &&
          (statusFilter === 'all' ||
            (statusFilter === 'selected' && selectedSet.has(r.key)) ||
            (statusFilter === 'excluded' && excluded.includes(r.key)) ||
            (statusFilter === 'pending' &&
              !selectedSet.has(r.key) &&
              !excluded.includes(r.key)) ||
            (statusFilter === 'centers' && r.center)) &&
          (maxDock === '' ||
            (r.docking !== null && r.docking <= Number(maxDock))) &&
          (maxGBSA === '' ||
            (r.mmgbsa !== null && r.mmgbsa <= Number(maxGBSA))),
      )
      .sort((a, b) =>
        sort === 'id'
          ? a.id.localeCompare(b.id, undefined, { numeric: true })
          : sort === 'logp-asc' || sort === 'logp-desc'
            ? compareLogP(a, b, sort === 'logp-desc' ? 'desc' : 'asc')
            : sort === 'cluster'
              ? a.cluster - b.cluster ||
                Number(b.center) - Number(a.center) ||
                a.sourceRow - b.sourceRow
              : (a[sort as 'mmgbsa' | 'docking' | 'mw'] ?? Infinity) -
                  (b[sort as 'mmgbsa' | 'docking' | 'mw'] ?? Infinity) ||
                a.sourceRow - b.sourceRow,
      );
  }, [
    rows,
    query,
    clusterFilter,
    regionSet,
    statusFilter,
    selectedSet,
    excluded,
    maxDock,
    maxGBSA,
    sort,
  ]);
  const requestedResidues = useMemo(
    () => [...new Set(residueQuery.split(/[\s,;，；]+/).filter(Boolean))],
    [residueQuery],
  );
  const receptorResidues = useMemo(
    () => [...new Set((receptors[receptorIndex]?.atoms || []).map(residueKey))],
    [receptors, receptorIndex],
  );
  const invalidResidues = requestedResidues.filter(
    (key) => !receptorResidues.includes(key),
  );
  const interactionStates = useMemo(
    () =>
      new Map(
        rows.map((r) => [
          r.key,
          residueInteractionState(
            interactionCache[
              interactionKey(receptors[receptorIndex], poses[r.key])
            ],
            requestedResidues,
            interactionType,
            residueMatch,
          ),
        ]),
      ),
    [
      rows,
      interactionCache,
      receptors,
      receptorIndex,
      poses,
      requestedResidues,
      interactionType,
      residueMatch,
    ],
  );
  const filtered = useMemo(
    () =>
      baseFiltered.filter(
        (r) =>
          interactionMode === 'all' ||
          (requestedResidues.length > 0 &&
            !invalidResidues.length &&
            interactionStates.get(r.key) === interactionMode),
      ),
    [
      baseFiltered,
      interactionMode,
      requestedResidues,
      invalidResidues.length,
      interactionStates,
    ],
  );
  async function batchInteractions() {
    const receptor = receptors[receptorIndex];
    if (!connection || !receptor || batchBusy) return;
    const pending = baseFiltered.filter(
      (r) =>
        poses[r.key]?.nativeId &&
        (!interactionCache[interactionKey(receptor, poses[r.key])] ||
          interactionCache[interactionKey(receptor, poses[r.key])].errors
            .length),
    );
    batchStop.current = false;
    setBatchBusy(true);
    let done = 0,
      failed = 0,
      update: Record<string, InteractionResult> = {};
    for (const row of pending) {
      if (batchStop.current) break;
      try {
        const result = await calculateInteractions(
          connection,
          receptor,
          poses[row.key],
        );
        update[interactionKey(receptor, poses[row.key])] = result;
        if (result.errors.length) failed++;
      } catch (e) {
        failed++;
        setMessage('互作计算未完成：' + (e as Error).message);
        // A broken engine connection should not trigger thousands of doomed requests.
        batchStop.current = true;
      }
      done++;
      if (done % 10 === 0 || done === pending.length || batchStop.current) {
        const chunk = update;
        setInteractionCache((old) => ({ ...old, ...chunk }));
        update = {};
      }
      setBatchProgress(
        `${done} / ${pending.length} · 失败或部分结果 ${failed}`,
      );
    }
    const chunk = update;
    setInteractionCache((old) => ({ ...old, ...chunk }));
    setBatchBusy(false);
    setBatchProgress(
      `${batchStop.current ? '已停止' : '计算完成'}：${done} / ${pending.length} · 失败或部分结果 ${failed}`,
    );
  }
  const visible = useMemo(
    () => new Set(filtered.map((r) => r.key)),
    [filtered],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)),
    safePage = Math.min(page, pages - 1),
    shown = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const unique = new Set(rows.map((r) => r.canonical)).size,
    covered = new Set(
      rows.filter((r) => selectedSet.has(r.key)).map((r) => r.cluster),
    ).size;
  const neighbors = useMemo(
    () =>
      current
        ? rows
            .filter((r) => r.key !== current.key)
            .map((row) => ({ row, s: similarity(current, row) }))
            .sort((a, b) => b.s - a.s)
            .slice(0, 5)
        : [],
    [rows, current],
  );
  const qualityCount =
    issues.length +
    warnings.length +
    rows.filter((r) => r.duplicateOf || r.multi || r.unspecifiedStereo).length;
  const dirty =
    threshold !== applied.threshold ||
    chirality !== applied.chirality ||
    radius !== applied.radius ||
    nBits !== applied.nBits ||
    basis !== applied.basis;
  function resetFilters() {
    setQuery('');
    setClusterFilter(null);
    setStatusFilter('all');
    setMaxDock('');
    setMaxGBSA('');
    setRegion(null);
    setInteractionMode('all');
    setResidueQuery('');
    setPage(0);
  }
  function toggle(r: Mol) {
    if (busy) return;
    const result = chooseCandidate(selected, r, allRows, candidateLimit ?? Infinity);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    setSelected(result.selected);
    setExcluded((s) => s.filter((k) => k !== r.key));
  }
  function togglePage(checked: boolean) {
    if (busy) return;
    const result = selectCandidatePage(selected, shown, allRows, checked, candidateLimit ?? Infinity);
    setSelected(result.selected);
    if (checked) setExcluded((keys) => keys.filter((key) => !result.selected.includes(key)));
    if (result.skipped) setMessage('已保留可加入的候选；跳过 ' + result.skipped + ' 条（相同规范结构已入选，或达到自定义上限）。');
  }
  function analyzeRange(restoreAll = false) {
    const limit = Number(retainCount);
    if (!restoreAll && (!Number.isSafeInteger(limit) || limit < 1)) {
      setMessage('请输入大于 0 的整数作为保留数量。');
      return;
    }
    resetFilters();
    run(records, {
      threshold,
      chirality,
      radius,
      nBits,
      basis,
      retention: restoreAll ? null : { limit, rank: retainRank },
    });
  }
  function exclude(r: Mol) {
    if (busy) return;
    setExcluded((s) =>
      s.includes(r.key) ? s.filter((k) => k !== r.key) : [...s, r.key],
    );
    setSelected((s) => s.filter((k) => k !== r.key));
  }
  function focus(key: string) {
    setActive(key);
    const index = filtered.findIndex((r) => r.key === key);
    if (index >= 0) setPage(Math.floor(index / pageSize));
  }
  function parseDraft(text = draft) {
    try {
      const p = parseInput(text);
      setParsed(p);
      setDraftMap(p.mapping);
      return p;
    } catch (e) {
      setMessage((e as Error).message);
      return null;
    }
  }
  async function loadFile(file: File) {
    try {
      if (/\.(maegz|mae|sdf|sd)$/i.test(file.name)) {
        await loadStructureData(file);
        return;
      }
      if (file.size > 20 * 1024 * 1024)
        throw Error('文件超过 20 MB，请精简后导入。');
      const text = await file.text();
      setDraft(text);
      setDraftName(file.name.replace(/\.[^.]+$/, ''));
      parseDraft(text);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  async function readStructures(
    file: File,
  ): Promise<{ structures: Structure[]; warnings: string[] }> {
    if (connection) {
      if (file.size > 150 * 1024 * 1024) throw Error('文件超过 150 MB');
      return engineRequest(connection, '/import', file, {
        'Content-Type': 'application/octet-stream',
        'X-File-Extension': '.' + file.name.split('.').pop()?.toLowerCase(),
      });
    }
    const text = await readStructureFile(file),
      R = await getRDKit();
    return {
      structures: /\.pdb$/i.test(file.name)
        ? parsePDB(text)
        : /\.(sdf|sd)$/i.test(file.name)
          ? parseSDF(text, R)
          : parseMaestro(text),
      warnings: [
        '浏览器读取模式：连接本地 Schrödinger 后重新导入，可读取原生立体信息并计算互作。',
      ],
    };
  }
  async function loadReceptor(file: File) {
    try {
      setBusy(true);
      setStage('读取受体');
      const data = await readStructures(file);
      const proteins = data.structures.filter((s) => s.protein);
      setReceptors((old) => [
        ...old,
        ...(proteins.length
          ? proteins
          : data.structures.map((s) => ({ ...s, protein: true }))),
      ]);
      setMessage(
        proteins.length
          ? `已添加 ${proteins.length} 条受体，可选择工作区受体或在姿态窗口中用于序列比对。`
          : '按你的受体导入操作载入结构；若无标准主链，将显示原子骨架。',
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function loadStructureData(file: File) {
    if (hasUnsaved && !isDemo && rows.length && !(await saveToWorkspace(true))) return;
    setBusy(true);
    setStage('读取结构与原始坐标');
    setProgress(3);
    try {
      const R = await getRDKit(),
        loaded = await readStructures(file),
        structures = loaded.structures;
      const proteins = structures.filter((s) => s.protein),
        ligands = structures.filter((s) => !s.protein);
      if (ligands.length > 5000) throw Error('单次最多导入 5000 个配体');
      if (!ligands.length) {
        setReceptors(proteins);
        setReceptorIndex(0);
        setBusy(false);
        setImportOpen(false);
        setMessage('已载入受体。请确认受体与当前配体使用相同坐标系。');
        return;
      }
      const poseMap: Record<string, Structure> = {},
        warnings: string[] = [...loaded.warnings];
      const data = ligands.map((s, i) => {
        const m = R.get_mol(s.properties.SMILES || toMolBlock(s));
        if (!m)
          throw Error(
            '原始记录 ' +
              s.sourceIndex +
              ' 无法转换为有效化学结构；未替换当前数据',
          );
        let smiles = '';
        try {
          smiles = m.get_smiles();
        } finally {
          m.delete();
        }
        poseMap['r' + i] = s;
        const props = s.properties;
        const docking = scoreProperty(props, 'docking');
        const mmgbsa = scoreProperty(props, 'mmgbsa');
        return {
          id: s.title,
          smiles,
          docking: docking.value,
          docking_property: docking.key,
          mmgbsa: mmgbsa.value,
          mmgbsa_property: mmgbsa.key,
          supplier: props.s_sd_Supplier || '',
          catalog_id: props['s_sd_Catalog\\_ID'] || props.catalog_id || '',
          source_record: s.sourceIndex,
          canvas_cluster: props.i_canvas_Canvas_Cluster_Index || '',
        };
      });
      const mmgbsaCount = data.filter((row) => row.mmgbsa !== '').length;
      if (!mmgbsaCount)
        warnings.push(
          '该文件的配体记录中未发现 MM/GBSA dG Bind 属性；Docking pose-viewer 文件通常只包含对接分数。请导入 Prime MM/GBSA 结果文件。',
        );
      else if (mmgbsaCount < data.length)
        warnings.push(
          `仅 ${mmgbsaCount} / ${data.length} 条配体记录包含 MM/GBSA 数值，缺失项保留为空。`,
        );
      if (!connection)
        warnings.push(
          'MAE/SDF 保留原始坐标。MAE 立体化学从三维几何读取；未逐条核对 Maestro 专有立体标签。订购前请与原始记录核对。',
        );
      if (proteins.length > 1)
        warnings.push('发现多个受体，请在三维受体选项中选择与配体匹配的一条。');
      // This CSV is an internal transport between the structure importer and
      // the record parser. Preserve negative docking/MMGBSA values verbatim;
      // downloaded CSV files still keep formula escaping enabled by default.
      const textCSV = csv(data, false),
        p = parseInput(textCSV),
        made = makeRecords(p, p.mapping);
      setPoses(poseMap);
      setReceptors(proteins);
      setReceptorIndex(0);
      run(
        made.records,
        { threshold, chirality, radius, nBits, basis },
        {
          text: textCSV,
          map: p.mapping,
          name: file.name,
          demo: false,
          warnings: [...made.warnings, ...warnings],
        },
      );
    } catch (e) {
      setBusy(false);
      setMessage((e as Error).message);
    }
  }
  async function importData() {
    if (hasUnsaved && !isDemo && rows.length && !(await saveToWorkspace(true))) return;
    try {
      if (!parsed || !draftMap) throw Error('请先解析数据并指定 SMILES 列。');
      const made = makeRecords(parsed, draftMap);
      setPoses({});
      setReceptors([]);
      run(
        made.records,
        { threshold, chirality, radius, nBits, basis },
        {
          text: draft,
          map: draftMap,
          name: draftName || '我的化合物库',
          demo: false,
          warnings: made.warnings,
        },
      );
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  function projectPayload() {
    return {
      format: 'pocket-atlas-project-v1',
      name: dataset,
      projectNotes,
      moleculeCount: rows.length,
      isDemo,
      raw,
      mapping,
      ...applied,
      poses,
      interactionCache,
      receptors,
      receptorIndex,
      selected,
      excluded,
      notes,
      candidateLimit,
      pageSize,
      rdkitVersion: version,
      savedAt: new Date().toISOString(),
    };
  }

  async function saveToWorkspace(silent = false) {
    if (!rows.length || busy || saveLock.current) return false;
    saveLock.current = true;
    try {
      const savedVersion = dirtyVersion.current;
      const payload = projectPayload();
      const stored = await putProject({
        id: projectId,
        name: dataset,
        savedAt: payload.savedAt,
        moleculeCount: rows.length,
        selectedCount: selected.length,
        payload,
      });
      savedProjectId.current = stored.id;
      setOpenIds((ids) => Array.from(new Set([...ids, stored.id])));
      setProjectId(stored.id);
      setClosedIds((ids) => ids.filter((id) => id !== stored.id));
      setLastSavedAt(payload.savedAt);
      if (savedVersion === dirtyVersion.current) setHasUnsaved(false);
      localStorage.setItem('pocket-atlas-active-project', stored.id);
      await refreshProjects();
      if (!silent) setMessage(directoryName() ? '项目已写入所选目录。' : '项目已保存到浏览器本机存储；可指定项目目录保存为文件。');
      return true;
    } catch (e) {
      setMessage('项目保存失败：' + (e as Error).message);
      return false;
    } finally { saveLock.current = false; }
  }

  const autosave = useRef(() => {});
  autosave.current = () => {
    if (hasUnsaved && !isDemo && rows.length && !busy && !metadataOpen && !closeTarget) void saveToWorkspace(true);
  };
  useEffect(() => {
    const timer = window.setInterval(
      () => {
        autosave.current();
      },
      30 * 60 * 1000,
    );
    return () => window.clearInterval(timer);
  }, []);

  function saveProject() {
    const payload = projectPayload();
    void saveToWorkspace(true);
    download(
      'PocketAtlas_' + dataset + '.json',
      JSON.stringify(payload, null, 2),
      'application/json',
    );
  }
  async function applyProject(p: any, id?: string) {
    if (batchBusy) {
      setMessage('请先停止互作批量计算，再切换项目。');
      return;
    }
    try {
      if (
        p.format !== 'pocket-atlas-project-v1' ||
        typeof p.raw !== 'string' ||
        !p.mapping ||
        typeof p.mapping.smiles !== 'string' ||
        !Number.isFinite(p.threshold) ||
        p.threshold < 0.1 ||
        p.threshold > 1 ||
        !Array.isArray(p.selected) ||
        p.selected.some((x: unknown) => typeof x !== 'string') ||
        !Array.isArray(p.excluded) ||
        p.excluded.some((x: unknown) => typeof x !== 'string') ||
        !p.notes ||
        Object.values(p.notes).some((x) => typeof x !== 'string')
      )
        throw Error('不是受支持的 Pocket Atlas 项目文件');
      suppressDirty.current = true;
      setProjectNotes(typeof p.projectNotes === 'string' ? p.projectNotes : '');
      setWorkspaceEmpty(false);
      setClosedIds((ids) => ids.filter((key) => key !== id));
      if (id) { setProjectId(id); setOpenIds((ids) => Array.from(new Set([...ids, id]))); }
      setCandidateLimit(Number.isSafeInteger(p.candidateLimit) && p.candidateLimit > 0 ? p.candidateLimit : null);
      setPageSize([20, 50, 100].includes(p.pageSize) ? p.pageSize : 20);
      setPoses(p.poses || {});
      setInteractionCache(p.interactionCache || {});
      setReceptors(p.receptors || []);
      setReceptorIndex(Number(p.receptorIndex) || 0);
      resetFilters();
      setBatchProgress('');
      const parsed = parseInput(p.raw),
        made = makeRecords(parsed, p.mapping);
      const retention: Retention = p.retention == null ? null : p.retention;
      if (
        retention &&
        (!Number.isSafeInteger(retention.limit) ||
          retention.limit < 1 ||
          !['mmgbsa', 'docking', 'source'].includes(retention.rank))
      )
        throw Error('项目的分析范围设置无效。');
      setRetainCount(String(retention?.limit || 500));
      setRetainRank(retention?.rank || 'mmgbsa');
      setThreshold(p.threshold);
      setChirality(!!p.chirality);
      setBasis(
        ['molecule', 'murcko', 'generic'].includes(p.basis)
          ? p.basis
          : 'molecule',
      );
      setRadius([1, 2, 3, 4].includes(p.radius) ? p.radius : 2);
      setNBits([1024, 2048, 4096].includes(p.nBits) ? p.nBits : 2048);
      run(
        made.records,
        {
          threshold: p.threshold,
          retention,
          chirality: !!p.chirality,
          radius: [1, 2, 3, 4].includes(p.radius) ? p.radius : 2,
          nBits: [1024, 2048, 4096].includes(p.nBits) ? p.nBits : 2048,
          basis: ['molecule', 'murcko', 'generic'].includes(p.basis)
            ? p.basis
            : 'molecule',
        },
        {
          text: p.raw,
          map: p.mapping,
          name: String(p.name || '恢复的项目'),
          demo: !!p.isDemo,
          warnings: made.warnings,
          restore: p,
        },
      );
      setLastSavedAt(p.savedAt || null);
      setHasUnsaved(false);
      window.setTimeout(() => {
        suppressDirty.current = false;
        setHasUnsaved(false);
      }, 1500);
    } catch (e) {
      setMessage('项目载入失败：' + (e as Error).message);
    }
  }
  async function restoreProject(file: File) {
    if (batchBusy) {
      setMessage('请先停止互作批量计算，再打开项目。');
      return;
    }
    if (hasUnsaved && !isDemo && rows.length && !(await saveToWorkspace(true))) return;
    if (file.size > 600 * 1024 * 1024) {
      setMessage('项目载入失败：项目文件过大');
      return;
    }
    try {
      const p = JSON.parse(await file.text());
      const id = 'project-' + Date.now();
      await applyProject(p, id);
    } catch (e) {
      setMessage('项目载入失败：' + (e as Error).message);
    }
  }

  async function switchProject(id: string) {
    if (id === projectId || busy || batchBusy) return;
    if (hasUnsaved && !isDemo && !(await saveToWorkspace(true))) return;
    const stored = await getProject(id).catch((e) => { setMessage((e as Error).message); return undefined; });
    if (!stored) {
      setMessage('未找到该本机项目。');
      return;
    }
    await applyProject(stored.payload, stored.id);
    localStorage.setItem('pocket-atlas-active-project', stored.id);
  }

  async function newProject() {
    if (batchBusy) {
      setMessage('请先停止互作批量计算，再新建项目。');
      return;
    }
    if (hasUnsaved && !isDemo && !(await saveToWorkspace(true))) return;
    suppressDirty.current = true;
    const id = 'project-' + Date.now();
    setProjectId(id);
    setDataset('新分析项目');
    setProjectNotes('');
    setWorkspaceEmpty(false);
    setCandidateLimit(null);
    setPageSize(20);
    setIsDemo(false);
    setRaw('');
    setRows([]);
    setAllRows([]);
    setRecords([]);
    setClusters([]);
    setIssues([]);
    setWarnings([]);
    setSelected([]);
    setExcluded([]);
    setNotes({});
    setPoses({});
    setReceptors([]);
    setInteractionCache({});
    setActive(null);
    setLastSavedAt(null);
    setHasUnsaved(false);
    setImportOpen(true);
    window.setTimeout(() => {
      suppressDirty.current = false;
    }, 500);
  }
  function clearWorkspace() {
    suppressDirty.current = true;
    setWorkspaceEmpty(true); setProjectId('project-' + crypto.randomUUID());
    setDataset('未打开项目'); setProjectNotes(''); setRaw('');
    setRows([]); setAllRows([]); setRecords([]); setClusters([]); setIssues([]); setWarnings([]);
    setSelected([]); setExcluded([]); setNotes({}); setPoses({}); setReceptors([]); setInteractionCache({});
    setActive(null); setLastSavedAt(null); setHasUnsaved(false); setCreatingProject(false); setMetadataOpen(false);
    window.setTimeout(() => { suppressDirty.current = false; }, 500);
  }
  async function changeDirectory() {
    if (busy || batchBusy || directoryBusy) return;
    if (hasUnsaved && !isDemo && rows.length) { setMessage('请先保存当前项目，再更换项目目录。'); return; }
    setDirectoryBusy(true);
    try { const name = await chooseDirectory(); setDirectoryLabel(name); setClosedIds([]); setOpenIds([]); await refreshProjects();
      if (rows.length && !isDemo) { setProjectId('project-' + crypto.randomUUID()); setPendingMetadataSave(true); }
      else clearWorkspace(); }
    catch (e) { if ((e as Error).name !== 'AbortError') setMessage((e as Error).message); }
    finally { setDirectoryBusy(false); }
  }
  async function rescanDirectory() {
    setDirectoryBusy(true);
    try {
      if (directoryName() && !(await directoryPermission(true))) throw Error('未获得目录读写授权。');
      await refreshProjects();
    } catch (e) { setMessage((e as Error).message); }
    finally { setDirectoryBusy(false); }
  }
  async function finishClose(save: boolean) {
    if (!closeTarget || busy || batchBusy) return;
    const target = closeTarget;
    if (save && target === projectId && rows.length && !(await saveToWorkspace(true))) return;
    setClosedIds((ids) => [...ids, target, ...(save && target === projectId ? [savedProjectId.current] : [])]);
    if (target === projectId) clearWorkspace();
    setCloseTarget(null);
  }
  useEffect(() => {
    if (!pendingMetadataSave || busy) return;
    setPendingMetadataSave(false);
    void saveToWorkspace().then((ok) => { if (ok) { setMetadataOpen(false); setCreatingProject(false); } });
  }, [pendingMetadataSave, busy]);
  function confirmMetadata() {
    if (!metadataName.trim()) { setMessage('请填写项目名称。'); return; }
    setDataset(metadataName.trim()); setProjectNotes(metadataNotes.trim()); setPendingMetadataSave(true);
  }
  function exportRows(which: 'selected' | 'all') {
    const activeKeys = new Set(rows.map((r) => r.key));
    const output = (which === 'selected' ? allRows : rows).filter(
      (r) => which === 'all' || selectedSet.has(r.key),
    );
    if (!output.length) {
      setMessage('还没有选中初筛候选。');
      return;
    }
    const data = output.map((r) => ({
      id: r.id,
      smiles: r.smiles,
      canonical_smiles: r.canonical,
      source_record: r.sourceRow,
      in_analysis_scope: activeKeys.has(r.key),
      cluster: activeKeys.has(r.key) ? r.cluster : '',
      cluster_center: activeKeys.has(r.key) ? r.center : '',
      center_tanimoto: activeKeys.has(r.key) ? r.centerSimilarity : '',
      docking: r.docking,
      mmgbsa: r.mmgbsa,
      molecular_weight: r.mw,
      logp: r.logp,
      tpsa: r.tpsa,
      supplier: r.supplier,
      catalog_id: r.catalog,
      decision: selectedSet.has(r.key)
        ? 'selected'
        : excluded.includes(r.key)
          ? 'excluded'
          : 'pending',
      notes: notes[r.key] || '',
      duplicate_of: r.duplicateOf || '',
      multiple_fragments: r.multi,
      unspecified_stereo: r.unspecifiedStereo,
      similarity_threshold: applied.threshold,
      scaffold: r.scaffold || '无环骨架',
      clustering_basis: applied.basis,
      fingerprint: `Morgan radius=${applied.radius} nBits=${applied.nBits}`,
      use_chirality: applied.chirality,
      rdkit_version: version,
      demo_data: isDemo,
      ...Object.fromEntries(
        Object.entries(r.raw).map(([k, v]) => ['source_' + k, v]),
      ),
    }));
    download(
      (isDemo ? 'DEMO_' : '') +
        (which === 'selected'
          ? '初筛候选_' + output.length
          : '完整分析_' + output.length) +
        '.csv',
      csv(data),
      'text/csv;charset=utf-8',
    );
  }
  return (
    <>
      <header className="topbar">
        <div className="brand">
          <Atom size={31} />
          <div>
            Pocket Atlas<small>MOLECULAR SELECTION</small>
          </div>
        </div>
        <div className="top-meta">
          <span>虚拟筛选 / 分子筛选工作台</span>
          <span>
            <i className="status-dot" />
            计算在当前浏览器完成
          </span>
          <button className="top-link" onClick={() => setMethodsOpen(true)}>
            <Info size={16} />
            分析方法
          </button>
        </div>
      </header>
      <main className="workspace">
        <div className="page-head">
          <div>
            <div className="eyebrow">
              COMPOUND WORKSPACE <span className="crumb">/ {dataset}</span>
            </div>
            <h1>探索化学空间，精选实验候选</h1>
            <p className="subtext">
              从结构家族到单个分子，结合评分完成采购前复核。
            </p>
          </div>
          <div className="actions">
            <input
              type="file"
              accept=".json"
              hidden
              ref={projectFile}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void restoreProject(f);
                e.target.value = '';
              }}
            />
            <button
              className="btn"
              disabled={busy}
              onClick={() => projectFile.current?.click()}
              title="载入已保存的项目"
            >
              <FolderOpen size={16} />
              <span className="hide-narrow">打开项目</span>
            </button>
            <button
              className="btn"
              disabled={!rows.length || busy}
              onClick={saveProject}
            >
              <Save size={16} />
              <span className="hide-narrow">保存项目</span>
            </button>
            <button
              className="btn primary"
              disabled={busy || batchBusy}
              onClick={() => setImportOpen(true)}
            >
              <Upload size={16} />
              导入分子
            </button>
          </div>
        </div>
        <section className="project-switcher" aria-label="分析项目">
          <div className="project-switcher-title">
            <FolderOpen size={18} />
            <div>
              <b>分析项目</b>
              <span>
                {hasUnsaved
                  ? '有未保存更改'
                  : lastSavedAt
                    ? `已保存 ${new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    : '尚未保存'}
              </span>
            </div>
          </div>
          <div className="project-tabs" role="tablist" aria-label="已保存项目">
            {[...projects].filter((project) => !closedIds.includes(project.id) && (project.id === projectId || openIds.includes(project.id)))
              .sort(
                (a, b) =>
                  Number(b.id === projectId) - Number(a.id === projectId),
              )
              .map((project) => (
                <div className="project-tab-item" key={project.id}><button
                  role="tab"
                  aria-selected={project.id === projectId}
                  key={project.id}
                  className={project.id === projectId ? 'active' : ''}
                  onClick={() => void switchProject(project.id)}
                  disabled={busy}
                >
                  <b>{project.name}</b>
                  <span>
                    {project.moleculeCount} 分子 · {project.selectedCount} 候选
                  </span>
                </button><button className="project-close" aria-label={"关闭项目 " + project.name} disabled={busy || batchBusy} onClick={() => setCloseTarget(project.id)}>×</button></div>
              ))}
            {!workspaceEmpty && !projects.some((project) => project.id === projectId) && (
              <div className="project-tab-item"><button className="active" role="tab" aria-selected="true">
                <b>{dataset}</b>
                <span>{rows.length} 分子 · 当前项目</span>
              </button><button className="project-close" aria-label={"关闭项目 " + dataset} disabled={busy || batchBusy} onClick={() => setCloseTarget(projectId)}>×</button></div>
            )}
          </div>
          <div className="project-directory">
            <div><b>项目目录：{directoryLabel || '未设置'}</b><span>{directoryStatus}</span></div>
            <button className="btn small" disabled={busy || directoryBusy || batchBusy} onClick={() => void changeDirectory()}>选择项目目录</button>
            <button className="btn small" disabled={busy || directoryBusy} onClick={() => void rescanDirectory()}>授权并检索</button>
            <label>浏览项目<select aria-label="浏览项目目录文件" value="" disabled={busy || directoryBusy} onChange={(e) => { if(e.target.value) void switchProject(e.target.value); }}><option value="">选择项目文件打开…</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {String(project.payload.projectNotes || '无备注')}</option>)}</select></label>
            <small>缓存位置：浏览器独立存储，与项目目录分开。目录按 JSON 项目文件检索；关闭标签不会删除文件。</small>
            {!!directoryWarnings.length && <details><summary>跳过 {directoryWarnings.length} 个非项目或无效文件</summary>{directoryWarnings.map((warning) => <p key={warning}>{warning}</p>)}</details>}
          </div>
          <div className="project-actions">
            <button className="btn small" disabled={!rows.length || busy} onClick={() => { setMetadataName(dataset); setMetadataNotes(projectNotes); setCreatingProject(false); setMetadataOpen(true); }}>项目名称与备注</button>
            <button
              className="btn small"
              onClick={() => void newProject()}
              disabled={busy}
            >
              <Plus size={14} /> 新建项目
            </button>
            <button
              className="btn small"
              onClick={() => void saveToWorkspace()}
              disabled={!rows.length || busy}
            >
              <Save size={14} /> {directoryLabel ? '保存到项目目录' : '保存到浏览器'}
            </button>
          </div>
        </section>
        {isDemo && (
          <div className="demo-banner">
            <span>
              <FlaskConical size={15} />
              <b>上传分子</b> · 在此处上传分子，创建分析项目。当前演示评分为模拟值。
            </span>
            <button onClick={() => setImportOpen(true)} disabled={busy}>
              上传分子 <ArrowUpRight size={15} />
            </button>
          </div>
        )}
        <div className="stats">
          <div className="stat">
            <div>
              <span>有效分子 / 导入记录</span>
              <strong>
                {rows.length.toLocaleString()}{' '}
                <em>/ {records.length.toLocaleString()}</em>
              </strong>
              <span>
                {issues.length
                  ? issues.length + ' 条无效结构待检查'
                  : '结构已通过解析'}
              </span>
            </div>
            <div className="stat-icon">
              <Database size={22} />
            </div>
          </div>
          <div className="stat">
            <div>
              <span>结构簇</span>
              <strong>{clusters.length}</strong>
              <span>Tanimoto ≥ {applied.threshold.toFixed(2)}</span>
            </div>
            <div className="stat-icon purple">
              <Layers3 size={22} />
            </div>
          </div>
          <div className="stat">
            <div>
              <span>独立规范结构</span>
              <strong>{unique}</strong>
              <span>{rows.length - unique} 条重复结构记录</span>
            </div>
            <div className="stat-icon teal">
              <Network size={22} />
            </div>
          </div>
          <button
            className={
              'stat shortlist-stat ' +
              (statusFilter === 'selected' ? 'stat-active' : '')
            }
            onClick={() => {
              resetFilters();
              setStatusFilter(statusFilter === 'selected' ? 'all' : 'selected');
            }}
          >
            <div>
              <span>初筛候选清单</span>
              <strong>
                {selected.length} <em>/ {candidateLimit ?? '不限'}</em>
              </strong>
              <span>
                已覆盖 {covered} / {clusters.length} 个结构簇
              </span>
            </div>
            <div className="stat-icon green">
              <ShoppingBag size={22} />
            </div>
          </button>
        </div>
        {busy && (
          <output className="analysis-progress">
            <span>{stage}</span>
            <Progress value={progress} />
            <b>{progress}%</b>
            <button
              className="text-button"
              onClick={() => {
                worker.current?.terminate();
                setBusy(false);
                setMessage('已取消本次分析；之前的结果仍保留。');
              }}
            >
              取消
            </button>
          </output>
        )}
        <section className="panel structure-workspace">
          <div className="panel-body">
            <div className="complex-toolbar">
              <strong>MAEGZ 结构阅览与互作</strong>
              <span className="tag">{engineStatus}</span>
              <button
                className="btn small"
                onClick={() => void connectLocalSchrodinger(true)}
              >
                {connection ? 'Schrödinger 已启用' : '检索并自动连接 Schrödinger'}
              </button>
              <button
                className="btn small"
                disabled={busy}
                onClick={() => receptorFile.current?.click()}
              >
                单独载入受体
              </button>
              <button
                className="btn small"
                disabled={!receptors.length}
                onClick={() => {
                  setViewPose(null);
                  setViewOpen(true);
                }}
              >
                查看蛋白
              </button>
              {receptors.length > 0 && (
                <Choice
                  label="工作区受体"
                  value={String(receptorIndex)}
                  onChange={(v) => setReceptorIndex(Number(v))}
                  options={receptors.map((r, i) => [
                    String(i),
                    `${r.title} · ${r.atoms.length} 原子`,
                  ])}
                />
              )}
            </div>
            <p className="micro">
              {receptors.length
                ? `${receptors.length} 条受体已载入 · 当前 ${receptors[receptorIndex]?.atoms.length || 0} 个原子`
                : '当前没有受体。纯配体 MAEGZ 不包含蛋白，请另行载入同坐标系受体或包含受体的复合物文件。'}{' '}
              · {Object.keys(poses).length} 条配体姿态
            </p>
            <details>
              <summary>Schrödinger 自动连接</summary>
              <p>
                使用 Pocket Atlas 启动器：首次运行选择 Schrödinger 安装目录，之后启动时自动桥接并打开工作台，无需连接文件。未安装
                Schrödinger 时可继续使用分子聚类；需要原生 MAEGZ 与互作分析时再运行启动器配置。
              </p>
              <a className="btn small" href="/pocket-atlas-launcher.zip" download>
                下载 Pocket Atlas 启动器
              </a>
            </details>
            <input
              hidden
              ref={receptorFile}
              type="file"
              accept=".mae,.maegz,.sdf,.pdb"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadReceptor(f);
                e.target.value = '';
              }}
            />
          </div>
        </section>
        <div className="main-grid">
          <aside className="analysis-sidebar">
            <section className="panel">
              <div className="panel-head">
                <h2>
                  <SlidersHorizontal size={16} />
                  聚类参数
                </h2>
              </div>
              <div className="panel-body params">
                <div className="label-row">
                  <span>相似度阈值</span>
                  <b className="number-pill">{threshold.toFixed(2)}</b>
                </div>
                <Slider
                  aria-label="Tanimoto 相似度阈值"
                  value={[threshold]}
                  onValueChange={(v) =>
                    setThreshold(
                      Number((Array.isArray(v) ? v[0] : v).toFixed(2)),
                    )
                  }
                  min={0.2}
                  max={0.95}
                  step={0.05}
                />
                <div className="range-label">
                  <span>0.20 · 宽松</span>
                  <span>0.95 · 严格</span>
                </div>
                <p className="micro">
                  Morgan · 半径 {radius} · {nBits} 位<br />
                  Butina · 动态更新邻居
                  <br />
                  骨架模式先对唯一骨架聚类，再映射回分子；无环分子以完整结构参与。
                </p>
                <details className="cluster-help">
                  <summary>阈值怎么选？骨架如何判定？</summary>
                  <p>
                    Tanimoto = 两个指纹共有的位数 / 任一指纹出现的位数，范围
                    0–1。它衡量结构指纹的相似性，不是结合能力或互作相似度。
                  </p>
                  <p>
                    可先试 0.50–0.65，再向两侧比较：0.30–0.45
                    适合粗分结构家族；0.65–0.80 可用于较近类似物；0.85–0.95
                    更严格。这些是探索起点，需在固定的骨架模式、半径和位数下检查代表结构，不能直接跨参数比较。
                  </p>
                  <p>
                    Murcko
                    骨架保留环及连接环的链，移除外围侧链；本实现还保留环/连接链上的末端双键原子。通用骨架在此基础上把原子视为碳、键视为单键，会合并杂原子和键型不同但拓扑相同的结构。无环分子使用完整分子指纹。
                  </p>
                  <p>
                    同一个精确骨架与“同簇”不同：相似骨架仍可归入同一簇。Butina
                    要求成员与当时选出的中心相似度 ≥
                    阈值，同簇任意两个成员不保证达标。提高阈值通常会细分家族，但簇数受中心重选影响，不保证严格单调。
                  </p>
                  <p>
                    建议比较 0.35 / 0.50 / 0.65 / 0.80
                    的代表结构、单成员簇比例和采购覆盖率，再结合 MM/GBSA
                    与口袋互作挑选；不必把簇数强行调到候选目标数量。
                  </p>
                </details>
                <label>
                  聚类依据
                  <Choice
                    label="聚类依据"
                    value={basis}
                    onChange={setBasis}
                    options={[
                      ['molecule', '完整分子'],
                      ['murcko', 'Murcko 骨架'],
                      ['generic', '通用 Murcko 骨架'],
                    ]}
                  />
                </label>
                <label>
                  Morgan 半径
                  <Choice
                    label="Morgan 半径"
                    value={String(radius)}
                    onChange={(v) => setRadius(Number(v))}
                    options={[1, 2, 3, 4].map((v) => [String(v), String(v)])}
                  />
                </label>
                <label>
                  指纹长度
                  <Choice
                    label="指纹长度"
                    value={String(nBits)}
                    onChange={(v) => setNBits(Number(v))}
                    options={[1024, 2048, 4096].map((v) => [
                      String(v),
                      String(v) + ' 位',
                    ])}
                  />
                </label>
                <div className="check-label">
                  <Checkbox
                    aria-label="指纹考虑手性"
                    checked={chirality}
                    onCheckedChange={(v) => setChirality(!!v)}
                  />
                  指纹考虑手性
                </div>
                <button
                  className="btn small full"
                  onClick={() =>
                    run(records, {
                      threshold,
                      chirality,
                      radius,
                      nBits,
                      basis,
                      retention: applied.retention,
                    })
                  }
                  disabled={busy || batchBusy || !records.length}
                >
                  <Play size={14} />
                  重新分析
                </button>
                {dirty && (
                  <p className="pending-note">参数已修改，重新分析后生效</p>
                )}
                <details className="cluster-help" open>
                  <summary>保留前 N 个分子进行分析</summary>
                  <label>
                    排名依据
                    <Choice
                      label="保留分子的排名依据"
                      value={retainRank}
                      onChange={(v) =>
                        setRetainRank(v as 'mmgbsa' | 'docking' | 'source')
                      }
                      options={[
                        ['mmgbsa', 'MM/GBSA · 从低到高'],
                        ['docking', 'Docking · 从低到高'],
                        ['source', '原始文件顺序'],
                      ]}
                    />
                  </label>
                  <label>
                    保留数量 N
                    <input
                      aria-label="保留分子数量"
                      type="number"
                      min="1"
                      step="1"
                      value={retainCount}
                      onChange={(e) => setRetainCount(e.target.value)}
                    />
                  </label>
                  <button
                    className="btn small full"
                    disabled={busy || batchBusy || !records.length}
                    onClick={() => analyzeRange()}
                  >
                    保留前 N 个并重新分析
                  </button>
                  <button
                    className="btn ghost small full"
                    disabled={busy || batchBusy || !applied.retention}
                    onClick={() => analyzeRange(true)}
                  >
                    恢复全部分子分析
                  </button>
                  <p className="micro">
                    当前分析 {rows.length} / {allRows.length} 个有效记录
                    {applied.retention &&
                      ` · 按${{ mmgbsa: 'MM/GBSA', docking: 'Docking', source: '原始顺序' }[applied.retention.rank]}保留前 ${applied.retention.limit} 个`}
                    。 从完整项目取前 N
                    个有效结构后重新聚类，不受列表筛选影响。分数越低排名越前；缺失分数不参与分数排名，同分按原始顺序。重复结构按记录计数。
                  </p>
                  <p className="micro">
                    原始数据、姿态、互作及采购选择保留；范围外候选仍占采购名额并可导出。恢复全部后可继续查看。分析范围随项目保存。
                  </p>
                </details>
              </div>
            </section>
            <section className="panel">
              <div className="panel-body">
                <details>
                  <summary>分组汇总 · {clusters.length} 组</summary>
                  <p className="micro">
                    {new Set(rows.map((r) => r.scaffold).filter(Boolean)).size}{' '}
                    种唯一骨架 · {rows.filter((r) => !r.scaffold).length}{' '}
                    条无环记录
                  </p>
                  <div style={{ maxHeight: 260, overflow: 'auto' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>组</th>
                          <th>分子</th>
                          <th>骨架</th>
                          <th>已选</th>
                        </tr>
                      </thead>
                      <tbody>
                        {clusters.map((c) => (
                          <tr key={c.id}>
                            <td>
                              <button
                                className="link-button"
                                onClick={() => {
                                  setClusterFilter(c.id);
                                  setPage(0);
                                }}
                              >
                                C{c.id}
                              </button>
                            </td>
                            <td>{c.size}</td>
                            <td>
                              {
                                new Set(
                                  c.members
                                    .map((i) => rows[i]?.scaffold)
                                    .filter(Boolean),
                                ).size
                              }
                            </td>
                            <td>
                              {
                                c.members.filter((i) =>
                                  selectedSet.has(rows[i]?.key),
                                ).length
                              }
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </div>
            </section>
            <section className="panel cluster-panel">
              <div className="panel-head">
                <h2>结构分组</h2>
                <span className="count-badge">{clusters.length}</span>
              </div>
              <div className="cluster-list">
                <button
                  className={
                    'cluster-row ' + (clusterFilter === null ? 'active' : '')
                  }
                  onClick={() => {
                    setClusterFilter(null);
                    setRegion(null);
                  }}
                >
                  <span>
                    <Layers3 size={15} />
                    全部结构簇
                  </span>
                  <b>{rows.length}</b>
                </button>
                {[...clusters]
                  .sort((a, b) => b.size - a.size || a.id - b.id)
                  .map((c) => (
                    <button
                      key={c.id}
                      className={
                        'cluster-row ' +
                        (clusterFilter === c.id ? 'active' : '')
                      }
                      onClick={() => {
                        setClusterFilter(c.id);
                        setPage(0);
                        setRegion(null);
                        setActive(rows[c.center].key);
                      }}
                    >
                      <span>
                        <i style={{ background: color(c.id) }} />
                        Cluster {String(c.id).padStart(2, '0')}
                        {c.members.some((i) =>
                          selectedSet.has(rows[i].key),
                        ) && <Check size={12} className="selected-mark" />}
                      </span>
                      <b>{c.size}</b>
                    </button>
                  ))}
              </div>
            </section>
          </aside>
          <section className="panel space-panel">
            <div className="panel-head chart-heading">
              <div>
                <h2>分子分布</h2>
                <p className="micro">
                  {chart === 'map'
                    ? '按结构簇着色 · FastMap 距离投影'
                    : '对接评分 × MM/GBSA · 数值越低越优先'}
                </p>
              </div>
              <Tabs
                value={chart}
                onValueChange={(v) => setChart(v as 'map' | 'scores')}
              >
                <TabsList>
                  <TabsTrigger value="map">化学空间</TabsTrigger>
                  <TabsTrigger value="scores">评分分布</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <Scatter
              key={chart + revision}
              rows={rows}
              visible={visible}
              selected={selected}
              active={active}
              onActive={focus}
              onRegion={(v) => {
                setRegion(v);
                setPage(0);
              }}
              mode={chart}
            />
            <div className="map-bottom">
              <div className="legend">
                <span>
                  <i className="legend-dot" />
                  结构簇
                </span>
                <span>
                  <i className="legend-ring" />
                  已选候选
                </span>
                <span>
                  <i className="legend-muted" />
                  未通过当前筛选
                </span>
              </div>
              <button
                className="text-button"
                onClick={() => setMethodsOpen(true)}
              >
                方法与边界 <Info size={13} />
              </button>
            </div>
            <div className="coverage">
              <div>
                <ShoppingBag size={17} />
                <b>候选清单</b>
                <span>{selected.length} / {candidateLimit ?? '不限'}</span>
              </div>
              <label className="candidate-limit">候选数量上限
                <input aria-label="候选数量上限" type="number" min="1" step="1" placeholder="不限" value={candidateLimit ?? ''}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (!value) setCandidateLimit(null);
                    else if (Number.isSafeInteger(Number(value)) && Number(value) > 0) setCandidateLimit(Number(value));
                  }} />
              </label>
              {candidateLimit !== null && <Progress value={Math.min(100, (selected.length / candidateLimit) * 100)} />}
              <p>
                {candidateLimit === null ? '数量不限' : selected.length > candidateLimit ? '已超出上限 ' + (selected.length - candidateLimit) + ' 个，原选择已保留' : '剩余 ' + (candidateLimit - selected.length) + ' 个名额'} · 覆盖 {covered} 个结构簇
              </p>
              {selected.some((k) => !rows.some((r) => r.key === k)) && (
                <p>
                  其中{' '}
                  {
                    selected.filter((k) => !rows.some((r) => r.key === k))
                      .length
                  }{' '}
                  个初筛候选在当前分析范围外，恢复全部可查看；导出仍包含这些候选。
                </p>
              )}
              <button
                className="text-button"
                onClick={() => {
                  resetFilters();
                  setStatusFilter('selected');
                }}
              >
                查看候选 <ArrowUpRight size={14} />
              </button>
            </div>
          </section>
          <aside className="panel detail-panel">
            <div className="panel-head">
              <h2>分子详情</h2>
              {current && (
                <span className="tag">
                  Cluster {String(current.cluster).padStart(2, '0')}
                </span>
              )}
            </div>
            {current ? (
              <>
                <div className="detail-body">
                  <div className="detail-title">
                    <h3>{current.id}</h3>
                    {current.center && (
                      <span className="tag neutral">聚类中心</span>
                    )}
                  </div>
                  <Molecule smiles={current.canonical} />
                  {poses[current.key] && (
                    <button
                      className="btn full"
                      onClick={() => {
                        setViewPose(poses[current.key]);
                        setViewOpen(true);
                      }}
                    >
                      查看对接姿态 · 3D
                    </button>
                  )}
                  {receptors.length > 0 && (
                    <label>
                      三维受体
                      <Choice
                        label="三维受体"
                        value={String(receptorIndex)}
                        onChange={(v) => setReceptorIndex(Number(v))}
                        options={receptors.map((r, i) => [
                          String(i),
                          `记录 ${r.sourceIndex} · ${r.title}`,
                        ])}
                      />
                    </label>
                  )}
                  {poses[current.key] && (
                    <p className="micro">
                      原始结构记录 {poses[current.key].sourceIndex} · Canvas{' '}
                      {current.raw.canvas_cluster || '未提供'}
                    </p>
                  )}
                  <details>
                    <summary>
                      骨架 ·{' '}
                      {
                        new Set(rows.map((r) => r.scaffold).filter(Boolean))
                          .size
                      }{' '}
                      种唯一骨架
                    </summary>
                    {current.scaffold ? (
                      <>
                        <Molecule smiles={current.scaffold} small />
                        <code style={{ overflowWrap: 'anywhere' }}>
                          {current.scaffold}
                        </code>
                      </>
                    ) : (
                      <p>无环结构：骨架聚类模式下使用完整分子指纹。</p>
                    )}
                  </details>
                  <div className="score-cards">
                    <div>
                      <span className="score-label">Docking</span>
                      <strong>{fmt(current.docking)}</strong>
                    </div>
                    <div>
                      <span className="score-label">MM/GBSA</span>
                      <strong>{fmt(current.mmgbsa)}</strong>
                    </div>
                  </div>
                  <div className="descriptors">
                    <span>
                      MW <b>{fmt(current.mw, 1)}</b>
                    </span>
                    <span>
                      cLogP <b>{fmt(current.logp, 2)}</b>
                    </span>
                    <span>
                      TPSA <b>{fmt(current.tpsa, 1)}</b>
                    </span>
                    <span>
                      HBD / HBA{' '}
                      <b>
                        {current.hbd} / {current.hba}
                      </b>
                    </span>
                  </div>
                  <details className="structure-text">
                    <summary>SMILES 与供应商信息</summary>
                    <code>{current.smiles}</code>
                    <p>
                      供应商：{current.supplier || '未提供'}
                      <br />
                      货号：{current.catalog || '未提供'}
                      <br />
                      相对簇中心 Tanimoto：{fmt(current.centerSimilarity, 3)}
                      <br />
                      MM/GBSA 字段：
                      {current.raw.mmgbsa_property || '文件中未找到'}
                    </p>
                  </details>
                  {(current.duplicateOf ||
                    current.multi ||
                    current.unspecifiedStereo > 0) && (
                    <div className="flags">
                      {current.duplicateOf && (
                        <span>相同结构：{current.duplicateOf}</span>
                      )}
                      {current.multi && <span>含多个片段 · 请核查盐型</span>}
                      {current.unspecifiedStereo > 0 && (
                        <span>
                          {current.unspecifiedStereo} 个未指定立体中心
                        </span>
                      )}
                    </div>
                  )}
                  <div className="detail-actions">
                    <button
                      className={
                        'btn full ' +
                        (selectedSet.has(current.key)
                          ? 'selected-btn'
                          : 'primary')
                      }
                      disabled={busy}
                      onClick={() => toggle(current)}
                    >
                      {selectedSet.has(current.key) ? (
                        <Check size={16} />
                      ) : (
                        <Plus size={16} />
                      )}{' '}
                      {selectedSet.has(current.key)
                        ? '已加入候选 · 点击移除'
                        : '加入初筛候选'}
                    </button>
                    <button
                      className={
                        'btn icon-only ' +
                        (excluded.includes(current.key) ? 'excluded-btn' : '')
                      }
                      disabled={busy}
                      title={
                        excluded.includes(current.key)
                          ? '撤销排除'
                          : '排除此分子'
                      }
                      aria-label={
                        excluded.includes(current.key)
                          ? '撤销排除'
                          : '排除此分子'
                      }
                      onClick={() => exclude(current)}
                    >
                      {excluded.includes(current.key) ? (
                        <RotateCcw size={16} />
                      ) : (
                        <Ban size={16} />
                      )}
                    </button>
                  </div>
                  <label className="note-label" htmlFor="decision-note">
                    复核备注
                    {excluded.includes(current.key) && (
                      <span className="tag amber">已排除</span>
                    )}
                  </label>
                  <textarea
                    id="decision-note"
                    className="note-input"
                    placeholder="例如：保留该系列代表，需复核结合姿态…"
                    value={notes[current.key] || ''}
                    onChange={(e) =>
                      setNotes((n) => ({ ...n, [current.key]: e.target.value }))
                    }
                  />
                </div>
                <div className="neighbor-block">
                  <h3>
                    最相似的分子 <span>Tanimoto</span>
                  </h3>
                  {neighbors.map(({ row, s }) => (
                    <button key={row.key} onClick={() => focus(row.key)}>
                      <span>
                        <i style={{ background: color(row.cluster) }} />
                        {row.id}
                      </span>
                      <b>
                        {s.toFixed(3)} <ChevronRight size={12} />
                      </b>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty">
                <Atom size={35} />
                <p>从散点图或列表中选择一个分子</p>
              </div>
            )}
          </aside>
          <section className="panel table-panel">
            <div className="panel-head">
              <div className="list-title">
                <h2>
                  {statusFilter === 'selected' ? '初筛候选清单' : '化合物列表'}
                </h2>
                <span className="count-badge">{filtered.length}</span>
                {clusterFilter !== null && (
                  <button
                    className="filter-chip"
                    onClick={() => setClusterFilter(null)}
                  >
                    Cluster {clusterFilter}
                    <X size={12} />
                  </button>
                )}
                {region !== null && (
                  <button
                    className="filter-chip"
                    onClick={() => setRegion(null)}
                  >
                    框选范围
                    <X size={12} />
                  </button>
                )}
              </div>
              <div className="actions">
                <button
                  className="text-button"
                  onClick={() => setQualityOpen(true)}
                >
                  <AlertTriangle size={14} />
                  数据检查 {qualityCount > 0 && <b>{qualityCount}</b>}
                </button>
                <button
                  className="btn small"
                  disabled={!rows.length || busy}
                  onClick={() => setExportOpen(true)}
                >
                  <Download size={14} />
                  导出
                </button>
              </div>
            </div>
            <div className="filters">
              <div className="search-box">
                <Search size={16} />
                <input
                  aria-label="搜索分子"
                  placeholder="搜索 ID、SMILES、供应商…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(0);
                  }}
                />
              </div>
              <Choice
                label="筛选状态"
                value={statusFilter}
                onChange={(v) => {
                  setStatusFilter(v);
                  setPage(0);
                }}
                options={[
                  ['all', '全部状态'],
                  ['selected', '初筛候选'],
                  ['pending', '待复核'],
                  ['excluded', '已排除'],
                  ['centers', '聚类中心'],
                ]}
              />
              <Choice
                label="排序方式"
                value={sort}
                onChange={(v) => {
                  setSort(v);
                  setPage(0);
                }}
                options={[
                  ['mmgbsa', 'MM/GBSA ↑'],
                  ['docking', 'Docking ↑'],
                  ['mw', '分子量 ↑'],
                  ['logp-asc', 'cLogP 升序 ↑'],
                  ['logp-desc', 'cLogP 降序 ↓'],
                  ['cluster', '结构簇'],
                  ['id', '化合物 ID'],
                ]}
              />
              <label className="score-filter">
                Docking ≤
                <input
                  aria-label="Docking 最高分数"
                  type="number"
                  step="any"
                  placeholder="不限"
                  value={maxDock}
                  onChange={(e) => {
                    setMaxDock(e.target.value);
                    setPage(0);
                  }}
                />
              </label>
              <label className="score-filter">
                MM/GBSA ≤
                <input
                  aria-label="MMGBSA 最高分数"
                  type="number"
                  step="any"
                  placeholder="不限"
                  value={maxGBSA}
                  onChange={(e) => {
                    setMaxGBSA(e.target.value);
                    setPage(0);
                  }}
                />
              </label>
              <button
                className="text-button"
                onClick={resetFilters}
                title="重置全部筛选"
              >
                <RotateCcw size={14} />
              </button>
            </div>
            <details className="interaction-filter">
              <summary>
                按指定残基互作筛选 · {Object.keys(interactionCache).length}{' '}
                组已缓存
              </summary>
              <div className="complex-toolbar">
                <label>
                  残基（逗号分隔）
                  <input
                    aria-label="互作筛选残基"
                    list="receptor-residues"
                    placeholder="A:GLU509, A:SER752"
                    value={residueQuery}
                    onChange={(e) => {
                      const value = e.target.value.trimStart();
                      setResidueQuery(value);
                      if (value.trim() && interactionMode === 'all')
                        setInteractionMode('yes');
                      setPage(0);
                    }}
                  />
                </label>
                <datalist id="receptor-residues">
                  {receptorResidues.map((key) => (
                    <option key={key} value={key} />
                  ))}
                </datalist>
                <label>
                  列表保留
                  <select
                    aria-label="互作筛选结果"
                    value={interactionMode}
                    onChange={(e) => {
                      setInteractionMode(e.target.value);
                      setPage(0);
                    }}
                  >
                    <option value="all">全部（仅统计，不筛选）</option>
                    <option value="yes">具有互作（应用到列表）</option>
                    <option value="no">不具有互作（已计算）</option>
                    <option value="unknown">未确定 / 待计算</option>
                  </select>
                </label>
                <label>
                  类型
                  <select
                    aria-label="互作筛选类型"
                    value={interactionType}
                    onChange={(e) => {
                      setInteractionType(e.target.value);
                      setPage(0);
                    }}
                  >
                    <option value="all">全部原生互作</option>
                    {Object.entries(interactionKinds)
                      .filter(([key]) => key !== 'contact')
                      .map(([key, [name]]) => (
                        <option key={key} value={key}>
                          {name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  多个残基
                  <select
                    aria-label="多个残基匹配规则"
                    value={residueMatch}
                    onChange={(e) => {
                      setResidueMatch(e.target.value);
                      if (requestedResidues.length && interactionMode === 'all')
                        setInteractionMode('yes');
                      setPage(0);
                    }}
                  >
                    <option value="any">任一残基有互作（OR）</option>
                    <option value="all">全部残基均有互作（AND）</option>
                  </select>
                </label>
              </div>
              <p className="micro">
                当前受体：{receptors[receptorIndex]?.title || '未载入'}
                。用链名:残基名编号精确匹配，空链用 _（如
                _:GLU509）。“不具有”为所选规则的否定；未计算或相关类型计算失败不作为阴性。几何近接不参与筛选。
              </p>
              {invalidResidues.length > 0 && (
                <p role="alert">
                  当前受体未找到：{invalidResidues.join('、')}
                  。请从建议中选择完整编号。
                </p>
              )}
              {interactionMode !== 'all' && !requestedResidues.length && (
                <p role="alert">请先输入目标残基。</p>
              )}
              <div className="complex-toolbar">
                <button
                  className="btn small"
                  disabled={
                    !connection ||
                    !receptors[receptorIndex] ||
                    batchBusy ||
                    busy
                  }
                  onClick={() => void batchInteractions()}
                >
                  计算待筛选分子的缺失互作（
                  {
                    baseFiltered.filter(
                      (r) =>
                        poses[r.key]?.nativeId &&
                        (!interactionCache[
                          interactionKey(receptors[receptorIndex], poses[r.key])
                        ] ||
                          interactionCache[
                            interactionKey(
                              receptors[receptorIndex],
                              poses[r.key],
                            )
                          ].errors.length),
                    ).length
                  }
                  ）
                </button>
                {batchBusy && (
                  <button
                    className="btn small"
                    onClick={() => {
                      batchStop.current = true;
                    }}
                  >
                    停止计算
                  </button>
                )}
                <span role="status" className="micro">
                  {batchProgress}
                </span>
              </div>
              <p className="micro">
                计算范围遵循搜索、结构簇、评分及采购状态筛选；不受互作结果筛选限制。可先选“初筛候选”缩小范围。已缓存结果随项目保存；无三维姿态的记录保持未确定。
              </p>
              {requestedResidues.length > 0 && !invalidResidues.length && (
                <div>
                  <p className="micro">
                    当前范围：有{' '}
                    {
                      baseFiltered.filter(
                        (r) => interactionStates.get(r.key) === 'yes',
                      ).length
                    }{' '}
                    · 无{' '}
                    {
                      baseFiltered.filter(
                        (r) => interactionStates.get(r.key) === 'no',
                      ).length
                    }{' '}
                    · 未确定{' '}
                    {
                      baseFiltered.filter(
                        (r) => interactionStates.get(r.key) === 'unknown',
                      ).length
                    }
                  </p>
                  <div
                    className="complex-toolbar"
                    aria-label="互作统计快捷筛选"
                  >
                    {(['yes', 'no', 'unknown', 'all'] as const).map((mode) => (
                      <button
                        key={mode}
                        className="btn small"
                        aria-pressed={interactionMode === mode}
                        onClick={() => {
                          setInteractionMode(mode);
                          setPage(0);
                        }}
                      >
                        {
                          {
                            yes: '仅显示有互作',
                            no: '仅显示无互作',
                            unknown: '仅显示未确定',
                            all: '显示全部',
                          }[mode]
                        }{' '}
                        {mode === 'all'
                          ? baseFiltered.length
                          : baseFiltered.filter(
                              (r) => interactionStates.get(r.key) === mode,
                            ).length}
                      </button>
                    ))}
                  </div>
                  <p className="micro" role="status">
                    {interactionMode === 'all'
                      ? `仅统计，未应用互作筛选：列表显示全部 ${filtered.length} 个分子。`
                      : `互作筛选已应用：列表保留 ${filtered.length} / ${baseFiltered.length} 个分子；${residueMatch === 'all' ? '全部残基（AND）' : '任一残基（OR）'} · ${{ yes: '具有互作', no: '不具有互作', unknown: '未确定' }[interactionMode as 'yes' | 'no' | 'unknown']}。`}
                  </p>
                </div>
              )}
            </details>
            <Table className="compound-table">
              <TableHeader>
                <TableRow>
                  <TableHead><Checkbox aria-label="全选当前页" disabled={busy || !shown.length}
                    checked={shown.length > 0 && shown.every((r) => selectedSet.has(r.key))}
                    indeterminate={shown.some((r) => selectedSet.has(r.key)) && !shown.every((r) => selectedSet.has(r.key))}
                    onCheckedChange={(checked) => togglePage(checked === true)} /> <span>当前页</span></TableHead>
                  <TableHead>化合物 ID</TableHead>
                  <TableHead>二维结构</TableHead>
                  <TableHead>结构簇</TableHead>
                  <TableHead>Docking</TableHead>
                  <TableHead>MM/GBSA</TableHead>
                  <TableHead>MW</TableHead>
                  <TableHead>cLogP</TableHead>
                  <TableHead>复核状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((r) => (
                  <TableRow
                    key={r.key}
                    className={r.key === active ? 'row-active' : ''}
                    onClick={() => focus(r.key)}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        disabled={busy}
                        checked={selectedSet.has(r.key)}
                        aria-label={
                          '选择 ' + r.id + ' 第 ' + r.sourceRow + ' 条'
                        }
                        onCheckedChange={() => toggle(r)}
                      />
                    </TableCell>
                    <TableCell>
                      <button className="id-link" onClick={() => focus(r.key)}>
                        {r.id}
                      </button>
                      <p className="micro">
                        {r.supplier || '供应商未提供'}
                        {r.catalog ? ' · ' + r.catalog : ''}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Molecule smiles={r.canonical} small />
                    </TableCell>
                    <TableCell>
                      <span
                        className="cluster-tag"
                        style={{
                          color: color(r.cluster),
                          background: color(r.cluster) + '12',
                        }}
                      >
                        <i style={{ background: color(r.cluster) }} />C
                        {String(r.cluster).padStart(2, '0')}
                      </span>
                    </TableCell>
                    <TableCell className="numeric">{fmt(r.docking)}</TableCell>
                    <TableCell className="numeric score-value">
                      {fmt(r.mmgbsa)}
                    </TableCell>
                    <TableCell className="numeric">{fmt(r.mw, 1)}</TableCell>
                    <TableCell className="numeric">{fmt(r.logp, 2)}</TableCell>
                    <TableCell>
                      <span
                        className={
                          'decision ' +
                          (selectedSet.has(r.key)
                            ? 'chosen'
                            : excluded.includes(r.key)
                              ? 'excluded'
                              : '')
                        }
                      >
                        {selectedSet.has(r.key)
                          ? '已入选'
                          : excluded.includes(r.key)
                            ? '已排除'
                            : '待复核'}
                      </span>
                      {r.duplicateOf && (
                        <span
                          className="quality-dot"
                          title={'与 ' + r.duplicateOf + ' 结构相同'}
                        >
                          重复
                        </span>
                      )}
                      {(r.multi || r.unspecifiedStereo > 0) && (
                        <span
                          className="quality-dot"
                          title="查看详情中的结构提示"
                        >
                          核查
                        </span>
                      )}
                      {notes[r.key] && (
                        <FileText size={13} className="inline-icon" />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!filtered.length && (
              <div className="empty compact">
                <Search size={24} />
                <p>
                  {rows.length
                    ? '没有符合当前条件的分子'
                    : '正在等待有效分子数据'}
                </p>
                <button className="text-button" onClick={resetFilters}>
                  重置筛选
                </button>
              </div>
            )}
            <div className="pagination-row">
              <span>
                显示 {filtered.length ? safePage * pageSize + 1 : 0}–
                {Math.min((safePage + 1) * pageSize, filtered.length)} /{' '}
                {filtered.length} 条
              </span>
              <button className="page-button" disabled={busy || !shown.some((r) => selectedSet.has(r.key))} onClick={() => togglePage(false)}>取消当前页选择</button>
              <label className="page-size">每页显示
                <select aria-label="每页显示分子数量" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }}>
                  {[20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
                </select> 个分子
              </label>
              <Pagination aria-label="分子列表分页">
                <PaginationContent>
                  <PaginationItem>
                    <button
                      className="page-button"
                      aria-label="上一页"
                      disabled={!safePage}
                      onClick={() => setPage(safePage - 1)}
                    >
                      <ChevronLeft size={16} />
                    </button>
                  </PaginationItem>
                  <PaginationItem>
                    <span className="page-label">
                      {safePage + 1} / {pages}
                    </span>
                  </PaginationItem>
                  <PaginationItem>
                    <button
                      className="page-button"
                      aria-label="下一页"
                      disabled={safePage >= pages - 1}
                      onClick={() => setPage(safePage + 1)}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          </section>
        </div>
        <footer className="footer">
          <span>
            <Atom size={13} />
            Pocket Atlas · RDKit {version || 'loading'} · Morgan / Tanimoto /
            Butina
          </span>
          <span>
            项目每 30 分钟自动保存到本机；未保存更改离站前会提示确认。
          </span>
          <button onClick={() => setMethodsOpen(true)}>使用说明</button>
        </footer>
      </main>
      <ComplexViewer
        open={viewOpen}
        connection={connection}
        cached={interactionCache}
        onCache={(key, value) =>
          setInteractionCache((old) => ({ ...old, [key]: value }))
        }
        ligand={viewPose}
        protein={receptors[receptorIndex] || null}
        proteins={receptors}
        onClose={() => {
          setViewPose(null);
          setViewOpen(false);
        }}
      />
      <Dialog open={metadataOpen} onOpenChange={(open) => { if (!creatingProject) setMetadataOpen(open); }}>
        <DialogContent><DialogHeader><DialogTitle>{creatingProject ? '确认新项目' : '项目名称与备注'}</DialogTitle><DialogDescription>确认项目名称与备注后保存。{directoryLabel ? '保存目录：' + directoryLabel : '尚未指定目录，将先保存到浏览器；之后可选择项目目录保存文件。'}</DialogDescription></DialogHeader>
          <label>项目名称<input className="project-meta-input" aria-label="确认项目名称" value={metadataName} onChange={(e) => setMetadataName(e.target.value)} maxLength={160} /></label>
          <label>项目备注<textarea className="project-meta-input" aria-label="项目备注" value={metadataNotes} onChange={(e) => setMetadataNotes(e.target.value)} placeholder="研究目的、数据来源、操作者或分析说明（可留空）" /></label>
          <button className="btn primary" disabled={busy || pendingMetadataSave || !metadataName.trim()} onClick={confirmMetadata}>确认并保存项目</button>
          {creatingProject && <button className="btn" onClick={() => { setMetadataOpen(false); setCloseTarget(projectId); }}>放弃新项目…</button>}
        </DialogContent>
      </Dialog>
      <Dialog open={!!closeTarget} onOpenChange={(open) => { if(!open) setCloseTarget(null); }}>
        <DialogContent><DialogHeader><DialogTitle>关闭项目前是否保存？</DialogTitle><DialogDescription>保存后关闭会保留最新修改；不保存关闭会放弃当前未保存更改。磁盘项目文件不会被删除。</DialogDescription></DialogHeader>
          <div className="actions"><button className="btn primary" disabled={busy} onClick={() => void finishClose(true)}>保存并关闭</button><button className="btn" disabled={busy} onClick={() => void finishClose(false)}>不保存关闭</button><button className="btn" onClick={() => setCloseTarget(null)}>取消</button></div>
        </DialogContent>
      </Dialog>
      <Dialog open={importOpen} onOpenChange={(v) => !busy && setImportOpen(v)}>
        <DialogContent className="import-dialog">
          <DialogHeader>
            <DialogTitle>导入化合物库</DialogTitle>
            <DialogDescription>
              支持 MAEGZ、MAE、SDF、CSV、TSV、SMI / TXT，或直接粘贴 SMILES。最多
              5000 行；分析不会上传你的分子数据。
            </DialogDescription>
          </DialogHeader>
          <div className="import-tools">
            <label className="upload-box">
              <Upload size={20} />
              <b>选择数据文件</b>
              <span>MAEGZ / MAE / SDF / CSV / SMI</span>
              <input
                type="file"
                accept=".csv,.tsv,.smi,.txt,.sdf,.sd,.mae,.maegz"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void loadFile(f);
                  e.target.value = '';
                }}
              />
            </label>
            <div>
              <button
                className="text-button"
                onClick={() =>
                  download(
                    'PocketAtlas_导入模板.csv',
                    '\uFEFFid,smiles,docking,mmgbsa,supplier,catalog_id\r\nCMP-001,CC(=O)Oc1ccccc1C(=O)O,,,供应商名称,货号\r\n',
                    'text/csv;charset=utf-8',
                  )
                }
              >
                <Download size={15} />
                下载 CSV 模板
              </button>
              <p className="micro">
                只有 SMILES 是必需项。
                <br />
                可将 Excel 另存为 CSV UTF-8 后导入。
              </p>
            </div>
          </div>
          <textarea
            aria-label="粘贴 SMILES 或表格"
            className="input-area import-text"
            placeholder={
              '每行一个 SMILES，或包含表头的表格：\nid,smiles,docking,mmgbsa\nCMP-001,CC(=O)Oc1ccccc1C(=O)O,-8.2,-42.1'
            }
            value={draft}
            disabled={busy}
            onChange={(e) => {
              setDraft(e.target.value);
              setParsed(null);
              setDraftMap(null);
            }}
          />
          <div className="actions">
            <label className="dataset-name">
              数据集名称
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                aria-label="数据集名称"
              />
            </label>
            <button
              className="btn small"
              onClick={() => parseDraft()}
              disabled={busy || !draft.trim()}
            >
              解析数据列
            </button>
          </div>
          {parsed && draftMap && (
            <>
              <div className="mapping-grid">
                {(
                  [
                    ['smiles', 'SMILES *'],
                    ['id', '化合物 ID'],
                    ['docking', 'Docking'],
                    ['mmgbsa', 'MM/GBSA'],
                    ['supplier', '供应商'],
                    ['catalog', '货号'],
                  ] as [keyof Mapping, string][]
                ).map(([key, label]) => (
                  <div key={key}>
                    <label>{label}</label>
                    <Choice
                      label={label + '列'}
                      value={draftMap[key]}
                      onChange={(v) => setDraftMap({ ...draftMap, [key]: v })}
                      options={[
                        ['__none', key === 'smiles' ? '请选择' : '未提供'],
                        ...parsed.headers.map(
                          (h) => [h, h] as [string, string],
                        ),
                      ]}
                    />
                  </div>
                ))}
              </div>
              <p className="subtext">
                识别到 <b>{parsed.rows.length}</b>{' '}
                条记录。未提供的分数保持为空；默认按数值从低到高排序。
              </p>
              <div className="import-preview">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {parsed.headers.map((h) => (
                        <TableHead key={h}>{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsed.rows.slice(0, 3).map((r, i) => (
                      <TableRow key={i}>
                        {parsed.headers.map((h, j) => (
                          <TableCell key={h}>{r[j] || '—'}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
          <div className="import-footer">
            <span className="micro">
              导入分子将创建独立项目。
              <br />
              分析完成后请确认项目名称与备注。
            </span>
            <button
              className="btn primary"
              disabled={busy || !parsed || !draftMap?.smiles}
              onClick={importData}
            >
              <Play size={16} />
              {busy ? '分析中…' : '开始结构分析'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={qualityOpen} onOpenChange={setQualityOpen}>
        <DialogContent className="report-dialog">
          <DialogHeader>
            <DialogTitle>数据检查</DialogTitle>
            <DialogDescription>
              无效结构不参与计算；重复及多片段记录保留供你核查。行号为不含表头的数据记录序号。
            </DialogDescription>
          </DialogHeader>
          <div className="quality-summary">
            <span>
              导入 <b>{records.length}</b>
            </span>
            <span>
              有效 <b>{rows.length}</b>
            </span>
            <span>
              无效 <b>{issues.length}</b>
            </span>
            <span>
              重复结构 <b>{rows.length - unique}</b>
            </span>
          </div>
          <div className="quality-scroll">
            {issues.map((q, i) => (
              <div className="quality-item" key={'e' + i}>
                <AlertTriangle size={16} />
                <div>
                  <b>
                    记录 {q.row} · {q.id}
                  </b>
                  <p>{q.reason}</p>
                  <code>{q.smiles}</code>
                </div>
              </div>
            ))}
            {warnings.map((q, i) => (
              <div className="quality-item" key={'w' + i}>
                <Info size={16} />
                <p>{q}</p>
              </div>
            ))}
            {rows
              .filter((r) => r.duplicateOf || r.multi || r.unspecifiedStereo)
              .map((r) => (
                <button
                  className="quality-item quality-button"
                  key={r.key}
                  onClick={() => {
                    setActive(r.key);
                    setQualityOpen(false);
                  }}
                >
                  <Info size={16} />
                  <div>
                    <b>
                      {r.id} · 记录 {r.sourceRow}
                    </b>
                    <p>
                      {[
                        r.duplicateOf ? '相同规范结构：' + r.duplicateOf : '',
                        r.multi ? '含多个分子片段，核查盐型' : '',
                        r.unspecifiedStereo ? '存在未指定立体中心' : '',
                      ]
                        .filter(Boolean)
                        .join('；')}
                    </p>
                  </div>
                </button>
              ))}
            {!qualityCount && (
              <p className="subtext">
                未检测到解析错误、规范结构重复或上述结构提示。
              </p>
            )}
          </div>
          <p className="micro">
            规范化 SMILES
            保留原盐型、质子化及互变异构状态；本工具未自动去盐或进行化学状态统一。
          </p>
          <button
            className="btn"
            disabled={!issues.length}
            onClick={() =>
              download(
                '无效结构记录.csv',
                csv(issues.map((i) => ({ ...i }))),
                'text/csv;charset=utf-8',
              )
            }
          >
            <Download size={15} />
            导出无效记录
          </button>
        </DialogContent>
      </Dialog>
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="export-dialog">
          <DialogHeader>
            <DialogTitle>导出筛选结果</DialogTitle>
            <DialogDescription>
              包括 ID、原始和规范
              SMILES、评分、结构簇、供应商、货号、决策与备注；完整保留原始列。
            </DialogDescription>
          </DialogHeader>
          {isDemo && (
            <span className="tag amber">当前为演示库，不能用于实际采购</span>
          )}
          <button
            className="export-option"
            disabled={!selected.length || busy}
            onClick={() => exportRows('selected')}
          >
            <ShoppingBag size={23} />
            <div>
              <b>初筛候选清单</b>
              <span>{selected.length} / {candidateLimit ?? '不限'} 个 · CSV，可用 Excel 打开</span>
            </div>
            <Download size={17} />
          </button>
          <button
            className="export-option"
            disabled={!rows.length || busy}
            onClick={() => exportRows('all')}
          >
            <Layers3 size={23} />
            <div>
              <b>完整分析结果</b>
              <span>{rows.length} 条有效记录 · 含未选中与排除记录</span>
            </div>
            <Download size={17} />
          </button>
          <button
            className="export-option"
            disabled={busy}
            onClick={saveProject}
          >
            <Save size={23} />
            <div>
              <b>保存可恢复项目</b>
              <span>JSON · 保留输入、参数、选择和备注</span>
            </div>
            <Download size={17} />
          </button>
        </DialogContent>
      </Dialog>
      <Dialog open={methodsOpen} onOpenChange={setMethodsOpen}>
        <DialogContent className="report-dialog">
          <DialogHeader>
            <DialogTitle>分析方法与使用说明</DialogTitle>
            <DialogDescription>
              用于结构多样性复核及候选管理，打分与结构相似性不代表实验活性。
            </DialogDescription>
          </DialogHeader>
          <div className="method-content">
            <h3>1. 输入与结构验证</h3>
            <p>
              粘贴每行一个 SMILES，或导入 CSV / TSV 并映射列。使用 RDKit
              解析、规范化结构并计算分子描述符。相同规范 SMILES
              的记录全部保留，初筛候选中仅允许选择一个；保留已指定的立体化学。未进行去盐、互变异构或质子化统一，建议使用与对接输入一致且经过统一处理的结构。
            </p>
            <h3>2. 按结构相似性分组</h3>
            <p>
              Morgan 二进制指纹，半径与位数可调，默认 radius = 2、2048
              位；默认不考虑手性，可打开手性选项。Tanimoto = 共有置位数 /
              合并置位数。Butina
              每轮选未分配邻居最多的分子作为中心，成员与中心满足 Tanimoto ≥
              阈值；同簇任意两成员不一定达到该阈值。平局按原始输入行序确定中心。0.60
              是可调的起始设置，不是活性判据。
            </p>
            <h3>3. 联动查看与人工挑选</h3>
            <p>
              点击图中分子、表格 ID
              或相似邻居更新详情；拖动图可筛选一片区域。左侧选择结构簇，按两种评分分别排序或过滤，逐个加入候选并记录原因。评分采用数值越低越优先的约定，缺失值排在最后，不将
              Docking 与 MM/GBSA 直接相加。坐标和排序不参与聚类。
            </p>
            <h3>4. 投影及采购边界</h3>
            <p>
              FastMap 将 1 − Tanimoto
              距离近似投影到二维，坐标无物理单位，近邻仍按原始指纹计算。重合点可在列表中分别查看。单分子簇不等同于新颖骨架，聚类中心也不一定是评分最优分子。候选数量默认不限，可在候选清单设置自定义上限，与簇数独立；可在同簇保留多个类似物。重新聚类保留现有选择及备注。
            </p>
            <h3>5. 保存与导出</h3>
            <p>
              分子计算在当前浏览器完成，不上传导入表格。项目保存在当前设备的本机项目库中，每
              30
              分钟自动保存；有未保存更改时离站会提示确认。“保存项目”还会下载可迁移的
              JSON 备份，下次可用“打开项目”恢复。CSV
              导出带公式注入防护，某些文本单元格可能增加前置单引号。采购前自行复核供应商货号、盐型、纯度、可供货性及结合姿态。
            </p>
            <div className="method-links">
              <a
                href="https://www.rdkitjs.com/"
                target="_blank"
                rel="noreferrer"
              >
                RDKit.js 官方说明 ↗
              </a>
              <a
                href="https://www.rdkit.org/docs/source/rdkit.ML.Cluster.Butina.html"
                target="_blank"
                rel="noreferrer"
              >
                Butina 方法与阈值 ↗
              </a>
              <a
                href="https://doi.org/10.1145/223784.223812"
                target="_blank"
                rel="noreferrer"
              >
                FastMap 原始论文 ↗
              </a>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {message && (
        <div className="message-bar" role="alert">
          <Info size={19} />
          <span>{message}</span>
          <button aria-label="关闭提示" onClick={() => setMessage('')}>
            <X size={17} />
          </button>
        </div>
      )}
    </>
  );
}
