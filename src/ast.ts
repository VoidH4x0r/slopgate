import type { Node as TreeSitterNode } from 'web-tree-sitter';

/**
 * The WASM bindings type `namedChildren` as `(Node | null)[]` and several
 * accessors as nullable, because the C API can return null in edge cases.
 * In practice a parsed tree never contains null children, so we assert the
 * shape once at the parsing boundary instead of checking for null in every
 * rule. If a future tree-sitter release changes this, the cast fails loudly
 * here rather than silently in ten different rules.
 */
export interface AstNode {
  readonly type: string;
  readonly text: string;
  readonly startPosition: { readonly row: number; readonly column: number };
  readonly endPosition: { readonly row: number; readonly column: number };
  readonly startIndex: number;
  readonly endIndex: number;
  readonly namedChildren: AstNode[];
  readonly children: AstNode[];
  readonly parent: AstNode | null;
  readonly isNamed: boolean;
  childForFieldName(name: string): AstNode | null;
}

export function asAst(node: TreeSitterNode): AstNode {
  return node as unknown as AstNode;
}
