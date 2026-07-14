#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const RETAINED_CHUNKS = new Set(["IHDR", "PLTE", "IDAT", "tRNS", "IEND"]);

for (const path of process.argv.slice(2)) {
  const source = readFileSync(path);
  if (!source.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error(`${path} is not a PNG file`);
  }

  const chunks = [PNG_SIGNATURE];
  let offset = PNG_SIGNATURE.length;
  while (offset < source.length) {
    if (offset + 12 > source.length) throw new Error(`${path} has a truncated PNG chunk`);
    const length = source.readUInt32BE(offset);
    const end = offset + length + 12;
    if (end > source.length) throw new Error(`${path} has a truncated PNG chunk payload`);
    const type = source.toString("ascii", offset + 4, offset + 8);
    if (RETAINED_CHUNKS.has(type)) chunks.push(source.subarray(offset, end));
    offset = end;
  }
  writeFileSync(path, Buffer.concat(chunks));
}
