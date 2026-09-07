import type { IncomingMessage, ServerResponse } from 'node:http'

/** A slicer found on this machine. `args` are passed before the model file. */
export interface SlicerInfo {
  id: string
  name: string
  path: string
  args?: string[]
}

export declare const MAX_BODY_BYTES: number

export declare function discoverSlicers(env?: Record<string, string | undefined>): SlicerInfo[]

export declare function pickSlicer(slicers: SlicerInfo[], id: string | null): SlicerInfo | null

export declare function sanitizeFileName(name: string): string

export declare function handleSlicer(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { enabled: boolean; maxBodyBytes?: number },
): Promise<boolean>
