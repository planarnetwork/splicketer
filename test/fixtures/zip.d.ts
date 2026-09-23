/**
 * Write a zip of the given files, deflated. Enough of the format for the feed readers to read.
 */
export declare function writeZip(path: string, files: Record<string, string>): string;
