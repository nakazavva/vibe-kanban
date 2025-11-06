import type { Diff, DiffChangeKind } from 'shared/types';
import { generateDiffFile } from '@git-diff-view/file';

export type FileStat = {
  id: string; // key used in DiffTab
  path: string; // newPath || oldPath || id
  change: DiffChangeKind;
  add: number;
  del: number;
};

export type DiffTreeNode =
  | {
      type: 'dir';
      name: string;
      path: string; // full path for directory
      children: DiffTreeNode[];
      add: number; // aggregated
      del: number; // aggregated
    }
  | {
      type: 'file';
      name: string;
      path: string; // full path for file
      id: string; // anchor id
      change: DiffChangeKind;
      add: number;
      del: number;
    };

function computeAddDelForDiff(diff: Diff): { add: number; del: number } {
  try {
    const oldName = diff.oldPath || diff.newPath || 'unknown';
    const newName = diff.newPath || diff.oldPath || 'unknown';
    const oldContent = diff.oldContent || '';
    const newContent = diff.newContent || '';
    const oldLang = '';
    const newLang = '';
    const file = generateDiffFile(
      oldName,
      oldContent,
      newName,
      newContent,
      oldLang,
      newLang
    );
    file.initRaw();
    return {
      add: file.additionLength ?? 0,
      del: file.deletionLength ?? 0,
    };
  } catch {
    return { add: 0, del: 0 };
  }
}

export function toFileStats(diffs: Diff[]): FileStat[] {
  return diffs.map((d, i) => {
    const id = d.newPath || d.oldPath || String(i);
    const path = (d.newPath || d.oldPath || String(i)).replace(/^\/+/, '');
    const { add, del } = computeAddDelForDiff(d);
    return { id, path, change: d.change, add, del };
  });
}

export function buildDiffTree(stats: FileStat[]): DiffTreeNode[] {
  const root: Record<string, DiffTreeNode> = {};

  for (const s of stats) {
    const parts = s.path.split('/').filter(Boolean);
    let cursor = root;
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLeaf = i === parts.length - 1;

      if (isLeaf) {
        cursor[part] = {
          type: 'file',
          name: part,
          path: currentPath,
          id: s.id,
          change: s.change,
          add: s.add,
          del: s.del,
        } as DiffTreeNode;
      } else {
        if (!cursor[part]) {
          cursor[part] = {
            type: 'dir',
            name: part,
            path: currentPath,
            children: [],
            add: 0,
            del: 0,
          } as DiffTreeNode;
        }
        // move cursor to children map
        const node = cursor[part] as DiffTreeNode;
        if (node.type !== 'dir') {
          // convert existing file node into dir (should not happen normally)
          cursor[part] = {
            type: 'dir',
            name: part,
            path: currentPath,
            children: [],
            add: node.add || 0,
            del: node.del || 0,
          } as DiffTreeNode;
        }
        // @ts-ignore - we want an object-style map at this level
        if (!cursor[part]._childMap) cursor[part]._childMap = {};
        // @ts-ignore
        cursor = cursor[part]._childMap;
      }
    }
  }

  // Convert to arrays and aggregate counts
  function toArray(map: Record<string, DiffTreeNode>): DiffTreeNode[] {
    const arr: DiffTreeNode[] = [];
    for (const key of Object.keys(map)) {
      const node = map[key];
      // @ts-ignore
      const childMap = node._childMap as Record<string, DiffTreeNode> | undefined;
      if (node.type === 'dir') {
        const children = childMap ? toArray(childMap) : [];
        let add = 0;
        let del = 0;
        for (const c of children) {
          add += c.add;
          del += c.del;
        }
        arr.push({ ...node, children, add, del });
      } else {
        arr.push(node);
      }
    }

    // Sort: directories first, then files; alphabetical by name
    arr.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return arr;
  }

  return toArray(root);
}

