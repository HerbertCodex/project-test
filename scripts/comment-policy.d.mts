export interface CommentFinding {
  line: number;
  kind: 'commented-out code' | 'narration';
  text: string;
}

export function findingsOf(path: string): CommentFinding[];
