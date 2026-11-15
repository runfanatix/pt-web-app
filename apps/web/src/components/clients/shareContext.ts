import type { Layout, LibraryExercise } from '@pt/core';

/** The open gym, so a programme made there can be turned into a message and a PDF with machine names and a route map. */
export interface ShareContext {
  gymId: string;
  /** "Virgin Active Bedfordview, 101 Van Buuren Rd". */
  gymLine: string;
  layout: Layout | null;
  library: LibraryExercise[];
}
