import { useMemo, useState, useCallback, useEffect } from 'react';
import type { Diff } from 'shared/types';
import { buildDiffTree, toFileStats, type DiffTreeNode } from '@/utils/diffTree';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  File as FileIcon,
  FilePlus2,
  Trash2,
  ArrowLeftRight,
  Copy,
  Key,
  PencilLine,
  SquarePlus,
  SquareMinus,
} from 'lucide-react';

type Props = {
  diffs: Diff[];
  activeId: string | null;
  onSelect: (id: string) => void;
  className?: string;
};

function ChangeIcon({ kind }: { kind: Diff['change'] }) {
  if (kind === 'deleted') return <Trash2 className="h-3.5 w-3.5 text-red-500" />;
  if (kind === 'renamed') return <ArrowLeftRight className="h-3.5 w-3.5" />;
  if (kind === 'added') return <FilePlus2 className="h-3.5 w-3.5 text-green-600" />;
  if (kind === 'copied') return <Copy className="h-3.5 w-3.5" />;
  if (kind === 'permissionChange') return <Key className="h-3.5 w-3.5" />;
  return <PencilLine className="h-3.5 w-3.5" />; // modified
}

function Counts({ add, del }: { add: number; del: number }) {
  return (
    <span className="ml-auto pl-2 text-[11px] tabular-nums">
      <span style={{ color: 'hsl(var(--console-success))' }}>+{add}</span>
      <span className="ml-1" style={{ color: 'hsl(var(--console-error))' }}>
        -{del}
      </span>
    </span>
  );
}

export function DiffFileTree({ diffs, activeId, onSelect, className }: Props) {
  const stats = useMemo(() => toFileStats(diffs), [diffs]);
  const tree = useMemo(() => buildDiffTree(stats), [stats]);
  const fileCount = stats.length;

  const allDirPaths = useMemo(() => {
    const paths: string[] = [];
    const walk = (nodes: DiffTreeNode[]) => {
      nodes.forEach((node) => {
        if (node.type === 'dir') {
          paths.push(node.path);
          walk(node.children);
        }
      });
    };
    walk(tree);
    return paths;
  }, [tree]);

  // Expanded state keyed by directory path
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(allDirPaths));

  useEffect(() => {
    setExpanded((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      let changed = false;
      allDirPaths.forEach((path) => {
        if (!next.has(path)) {
          next.add(path);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [allDirPaths]);

  const toggleDir = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }, []);

  const renderNode = (node: DiffTreeNode, depth = 0) => {
    const padding = 8 + depth * 12;
    if (node.type === 'dir') {
      const isOpen = expanded.has(node.path);
      return (
        <div key={node.path} className="min-w-0">
          <button
            type="button"
            aria-expanded={isOpen}
            onClick={() => toggleDir(node.path)}
            className="w-full flex items-center justify-start gap-1.5 px-2 py-1 rounded hover:bg-muted/60 overflow-hidden"
            style={{ paddingLeft: padding }}
          >
            {isOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            {isOpen ? (
              <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <Folder className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="text-sm font-medium text-foreground/90 flex-1 min-w-0 truncate text-left">
              {node.name}
            </span>
            <Counts add={node.add} del={node.del} />
          </button>
          {isOpen && node.children.map((c) => renderNode(c, depth + 1))}
        </div>
      );
    }

    const isActive = activeId === node.id;
    return (
      <button
        key={node.id}
        type="button"
        onClick={() => onSelect(node.id)}
        className={`w-full flex items-center justify-start gap-2 px-2 py-1 rounded hover:bg-muted/60 overflow-hidden ${
          isActive ? 'bg-muted' : ''
        }`}
        style={{ paddingLeft: padding + 14 }}
        aria-current={isActive ? 'true' : undefined}
      >
        {/* Using change icon if available, else generic file */}
        {node.change ? (
          <ChangeIcon kind={node.change} />
        ) : (
          <FileIcon className="h-3.5 w-3.5" />
        )}
        <span
          className="text-sm font-mono truncate flex-1 min-w-0 text-foreground text-left"
          title={node.path}
        >
          {node.name}
        </span>
        <Counts add={node.add} del={node.del} />
      </button>
    );
  };

  const allCollapsed = expanded.size === 0;
  const hasDirectories = allDirPaths.length > 0;

  const toggleAll = useCallback(() => {
    setExpanded((prev) => {
      if (prev.size === 0) {
        return new Set(allDirPaths);
      }
      return new Set<string>();
    });
  }, [allDirPaths]);

  return (
    <aside
      className={`border-r shrink-0 w-[18rem] min-w-[14rem] h-full min-h-0 overflow-y-auto flex flex-col bg-background ${className || ''}`}
    >
      <div className="sticky top-0 z-10 bg-background border-b">
        <div className="px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
          <span className="font-medium text-foreground">
            {fileCount === 1 ? 'File Changed' : 'Files Changed'}
          </span>
          <span className="text-muted-foreground tabular-nums">({fileCount})</span>
          <button
            type="button"
            onClick={toggleAll}
            aria-expanded={!allCollapsed}
            aria-label={allCollapsed ? 'Expand file tree' : 'Collapse file tree'}
            title={allCollapsed ? '展開' : '折りたたむ'}
            disabled={!hasDirectories}
            className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted/60 disabled:opacity-50 disabled:hover:bg-transparent"
          >
            {allCollapsed ? (
              <SquarePlus className="h-4 w-4" />
            ) : (
              <SquareMinus className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
      <div className="py-1 flex-1 min-h-0">
        {tree.map((n) => renderNode(n))}
      </div>
    </aside>
  );
}

export default DiffFileTree;
