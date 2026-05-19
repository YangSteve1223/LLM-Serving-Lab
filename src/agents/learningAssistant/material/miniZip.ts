import { inflateRawSync } from "node:zlib";

type ZipEntry = {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  localHeaderOffset: number;
};

export class MiniZipReader {
  private entries: Map<string, ZipEntry>;
  private buffer: Buffer;

  constructor(buffer: Buffer) {
    this.buffer = buffer;
    this.entries = readCentralDirectory(buffer);
  }

  list(): string[] {
    return [...this.entries.keys()];
  }

  has(name: string): boolean {
    return this.entries.has(normalizeZipPath(name));
  }

  read(name: string): Buffer | undefined {
    const entry = this.entries.get(normalizeZipPath(name));
    if (!entry) return undefined;

    const offset = entry.localHeaderOffset;
    if (this.buffer.readUInt32LE(offset) !== 0x04034b50) {
      throw new Error(`Invalid local file header for ${entry.name}`);
    }
    const fileNameLength = this.buffer.readUInt16LE(offset + 26);
    const extraLength = this.buffer.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + fileNameLength + extraLength;
    const compressed = this.buffer.subarray(dataStart, dataStart + entry.compressedSize);

    if (entry.compressionMethod === 0) return Buffer.from(compressed);
    if (entry.compressionMethod === 8) return inflateRawSync(compressed);
    throw new Error(`Unsupported zip compression method ${entry.compressionMethod} for ${entry.name}`);
  }

  readText(name: string): string | undefined {
    const data = this.read(name);
    return data?.toString("utf8");
  }
}

function readCentralDirectory(buffer: Buffer): Map<string, ZipEntry> {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map<string, ZipEntry>();

  let offset = centralDirectoryOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Invalid central directory record");
    }
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = normalizeZipPath(buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8"));

    entries.set(name, {
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset
    });

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("Could not find zip end of central directory");
}

function normalizeZipPath(name: string): string {
  return name.replaceAll("\\", "/").replace(/^\/+/, "");
}
