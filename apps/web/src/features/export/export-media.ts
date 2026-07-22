import type { GuidePdfExportWarning, GuidePdfExportModel, GuidePdfResource } from './export-model';
import { isPublicVideoUrl } from './export-model';

export { isPublicVideoUrl } from './export-model';

export interface PreparedGuidePdfMedia {
  imageSourceByUrl: ReadonlyMap<string, string>;
  qrDataUrlByVideoId: ReadonlyMap<string, string>;
  warnings: GuidePdfExportWarning[];
  objectUrls: string[];
}

export type ProtectedMediaLoader = (path: string) => Promise<string>;
export type QrDataUrlFactory = (url: string) => Promise<string>;

const PROTECTED_MEDIA_PREFIX = '/api/media/';

export async function prepareGuidePdfMedia(
  model: GuidePdfExportModel,
  loadProtectedMedia: ProtectedMediaLoader,
  makeQrDataUrl: QrDataUrlFactory = defaultQrDataUrl,
): Promise<PreparedGuidePdfMedia> {
  const imageSourceByUrl = new Map<string, string>();
  const qrDataUrlByVideoId = new Map<string, string>();
  const objectUrls: string[] = [];
  const warnings = [...model.warnings];
  const imageUrls = collectImageUrls(model);

  for (const imageUrl of imageUrls) {
    if (!isProtectedMediaUrl(imageUrl)) {
      imageSourceByUrl.set(imageUrl, imageUrl);
      continue;
    }
    try {
      const objectUrl = await loadProtectedMedia(imageUrl);
      if (!objectUrl) throw new Error('媒体对象地址为空');
      imageSourceByUrl.set(imageUrl, objectUrl);
      objectUrls.push(objectUrl);
    } catch (reason) {
      appendWarning(warnings, {
        code: 'IMAGE_LOAD_FAILED',
        message: `图片“${imageUrl}”载入失败：${reason instanceof Error ? reason.message : '未知错误'}`,
        nodeId: findImageNodeId(model, imageUrl),
      });
    }
  }

  for (const resource of collectVideoResources(model)) {
    if (!isPublicVideoUrl(resource.url)) {
      appendWarning(warnings, {
        code: 'VIDEO_URL_NOT_PUBLIC',
        message: `视频“${resource.caption || resource.id}”不是可公开访问的 HTTP(S) 地址，无法生成外部二维码。`,
        nodeId: resource.id,
      });
      continue;
    }
    try {
      const qrDataUrl = await makeQrDataUrl(resource.url);
      if (!qrDataUrl) throw new Error('二维码数据为空');
      qrDataUrlByVideoId.set(resource.id, qrDataUrl);
    } catch (reason) {
      appendWarning(warnings, {
        code: 'VIDEO_QR_FAILED',
        message: `视频“${resource.caption || resource.id}”二维码生成失败：${reason instanceof Error ? reason.message : '未知错误'}`,
        nodeId: resource.id,
      });
    }
  }

  return { imageSourceByUrl, qrDataUrlByVideoId, warnings, objectUrls };
}

export function releaseGuidePdfMedia(media: PreparedGuidePdfMedia): void {
  const objectUrls = media.objectUrls.splice(0, media.objectUrls.length);
  objectUrls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
}

function isProtectedMediaUrl(url: string): boolean {
  return url.startsWith(PROTECTED_MEDIA_PREFIX);
}

function collectImageUrls(model: GuidePdfExportModel): string[] {
  const urls = new Set<string>();
  model.steps.forEach((step) => {
    step.resources.forEach((resource) => {
      if (resource.kind !== 'image') return;
      urls.add(resource.url);
      resource.annotations.forEach((annotation) => {
        annotation.supplementalImages?.forEach((supplement) => urls.add(supplement.url));
      });
    });
  });
  return [...urls];
}

function collectVideoResources(model: GuidePdfExportModel): Extract<GuidePdfResource, { kind: 'video' }>[] {
  return model.steps.flatMap((step) => step.resources.filter((resource): resource is Extract<GuidePdfResource, { kind: 'video' }> => resource.kind === 'video'));
}

function findImageNodeId(model: GuidePdfExportModel, url: string): string {
  for (const step of model.steps) {
    const image = step.resources.find((resource) => resource.kind === 'image' && (
      resource.url === url || resource.annotations.some((annotation) => annotation.supplementalImages?.some((supplement) => supplement.url === url))
    ));
    if (image?.kind === 'image') return image.id;
  }
  return url;
}

function appendWarning(warnings: GuidePdfExportWarning[], warning: GuidePdfExportWarning): void {
  if (warnings.some((existing) => existing.code === warning.code && existing.nodeId === warning.nodeId)) return;
  warnings.push(warning);
}

const QR_BLOCKS_M: readonly (readonly QrBlockSpec[])[] = [
  [{ totalCodewords: 26, dataCodewords: 16 }],
  [{ totalCodewords: 44, dataCodewords: 28 }],
  [{ totalCodewords: 70, dataCodewords: 44 }],
  [{ totalCodewords: 50, dataCodewords: 32 }, { totalCodewords: 50, dataCodewords: 32 }],
  [{ totalCodewords: 67, dataCodewords: 43 }, { totalCodewords: 67, dataCodewords: 43 }],
  [
    { totalCodewords: 43, dataCodewords: 27 },
    { totalCodewords: 43, dataCodewords: 27 },
    { totalCodewords: 43, dataCodewords: 27 },
    { totalCodewords: 43, dataCodewords: 27 },
  ],
  [
    { totalCodewords: 49, dataCodewords: 31 },
    { totalCodewords: 49, dataCodewords: 31 },
    { totalCodewords: 49, dataCodewords: 31 },
    { totalCodewords: 49, dataCodewords: 31 },
  ],
  [
    { totalCodewords: 60, dataCodewords: 38 },
    { totalCodewords: 60, dataCodewords: 38 },
    { totalCodewords: 61, dataCodewords: 39 },
    { totalCodewords: 61, dataCodewords: 39 },
  ],
  [
    { totalCodewords: 58, dataCodewords: 36 },
    { totalCodewords: 58, dataCodewords: 36 },
    { totalCodewords: 58, dataCodewords: 36 },
    { totalCodewords: 59, dataCodewords: 37 },
    { totalCodewords: 59, dataCodewords: 37 },
  ],
  [
    { totalCodewords: 69, dataCodewords: 43 },
    { totalCodewords: 69, dataCodewords: 43 },
    { totalCodewords: 69, dataCodewords: 43 },
    { totalCodewords: 69, dataCodewords: 43 },
    { totalCodewords: 70, dataCodewords: 44 },
  ],
];

interface QrBlockSpec {
  totalCodewords: number;
  dataCodewords: number;
}

async function defaultQrDataUrl(url: string): Promise<string> {
  return encodeQrAsSvgDataUrl(url);
}

function encodeQrAsSvgDataUrl(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const version = chooseQrVersion(bytes.length);
  const codewords = makeQrCodewords(bytes, version);
  const matrix = makeQrMatrix(version, codewords);
  const margin = 1;
  const moduleCount = matrix.length;
  const size = moduleCount + margin * 2;
  const darkModules: string[] = [];
  matrix.forEach((row, rowIndex) => row.forEach((module, columnIndex) => {
    if (module === 1) darkModules.push(`<rect x="${columnIndex + margin}" y="${rowIndex + margin}" width="1" height="1"/>`);
  }));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><g fill="#000">${darkModules.join('')}</g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function chooseQrVersion(byteLength: number): number {
  for (let version = 1; version <= QR_BLOCKS_M.length; version += 1) {
    const dataCapacity = QR_BLOCKS_M[version - 1]!.reduce((sum, block) => sum + block.dataCodewords, 0);
    const characterCountBits = version < 10 ? 8 : 16;
    if (4 + characterCountBits + byteLength * 8 <= dataCapacity * 8) return version;
  }
  throw new Error('二维码地址过长，无法在第一版导出中编码');
}

function makeQrCodewords(bytes: Uint8Array, version: number): Uint8Array {
  const blocks = QR_BLOCKS_M[version - 1]!;
  const dataCapacity = blocks.reduce((sum, block) => sum + block.dataCodewords, 0);
  const bits: number[] = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, version < 10 ? 8 : 16);
  bytes.forEach((byte) => appendBits(bits, byte, 8));
  appendBits(bits, 0, Math.min(4, dataCapacity * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const data = new Uint8Array(dataCapacity);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = bits.slice(index * 8, index * 8 + 8).reduce((value, bit) => (value << 1) | bit, 0);
  }
  let dataIndex = Math.ceil(bits.length / 8);
  let pad = 0;
  while (dataIndex < data.length) {
    data[dataIndex] = pad % 2 === 0 ? 0xec : 0x11;
    dataIndex += 1;
    pad += 1;
  }

  const dataBlocks: Uint8Array[] = [];
  const errorBlocks: Uint8Array[] = [];
  let offset = 0;
  blocks.forEach((block) => {
    const dataBlock = data.slice(offset, offset + block.dataCodewords);
    offset += block.dataCodewords;
    dataBlocks.push(dataBlock);
    errorBlocks.push(reedSolomonRemainder(dataBlock, block.totalCodewords - block.dataCodewords));
  });
  const codewords: number[] = [];
  const maximumDataLength = Math.max(...dataBlocks.map((block) => block.length));
  for (let index = 0; index < maximumDataLength; index += 1) {
    dataBlocks.forEach((block) => {
      if (index < block.length) codewords.push(block[index]!);
    });
  }
  const maximumErrorLength = Math.max(...errorBlocks.map((block) => block.length));
  for (let index = 0; index < maximumErrorLength; index += 1) {
    errorBlocks.forEach((block) => {
      if (index < block.length) codewords.push(block[index]!);
    });
  }
  return Uint8Array.from(codewords);
}

function appendBits(bits: number[], value: number, length: number): void {
  for (let index = length - 1; index >= 0; index -= 1) bits.push((value >>> index) & 1);
}

function reedSolomonRemainder(data: Uint8Array, degree: number): Uint8Array {
  const generator = reedSolomonGenerator(degree);
  const result = new Uint8Array(degree);
  data.forEach((byte) => {
    const factor = byte ^ result[0]!;
    result.copyWithin(0, 1);
    result[degree - 1] = 0;
    for (let index = 0; index < degree; index += 1) result[index] = result[index]! ^ gfMultiply(generator[index + 1]!, factor);
  });
  return result;
}

function reedSolomonGenerator(degree: number): Uint8Array {
  const generator = [1];
  for (let index = 0; index < degree; index += 1) {
    const next = new Array<number>(generator.length + 1).fill(0);
    generator.forEach((coefficient, coefficientIndex) => {
      next[coefficientIndex] = next[coefficientIndex]! ^ coefficient;
      next[coefficientIndex + 1] = next[coefficientIndex + 1]! ^ gfMultiply(coefficient, GF_EXP[index]!);
    });
    generator.splice(0, generator.length, ...next);
  }
  return Uint8Array.from(generator);
}

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
initializeGaloisField();

function initializeGaloisField(): void {
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    GF_EXP[index] = value;
    GF_LOG[value] = index;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let index = 255; index < GF_EXP.length; index += 1) GF_EXP[index] = GF_EXP[index - 255]!;
}

function gfMultiply(left: number, right: number): number {
  if (left === 0 || right === 0) return 0;
  return GF_EXP[GF_LOG[left]! + GF_LOG[right]!]!;
}

function makeQrMatrix(version: number, codewords: Uint8Array): number[][] {
  const size = version * 4 + 17;
  const base = Array.from({ length: size }, () => new Array<number>(size).fill(-1));
  drawFunctionPatterns(base, version);
  let bestMatrix: number[][] | undefined;
  let bestPenalty = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = base.map((row) => [...row]);
    drawCodewords(candidate, codewords, mask);
    drawFormatBits(candidate, mask);
    const penalty = qrPenalty(candidate);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMatrix = candidate;
    }
  }
  return bestMatrix!;
}

function drawFunctionPatterns(matrix: number[][], version: number): void {
  const size = matrix.length;
  drawFinderPattern(matrix, 3, 3);
  drawFinderPattern(matrix, 3, size - 4);
  drawFinderPattern(matrix, size - 4, 3);
  const alignmentCenters = alignmentPatternCenters(version);
  alignmentCenters.forEach((row) => alignmentCenters.forEach((column) => {
    if (matrix[row]![column] === -1) drawAlignmentPattern(matrix, row, column);
  }));
  for (let index = 8; index < size - 8; index += 1) {
    if (matrix[6]![index] === -1) matrix[6]![index] = index % 2 === 0 ? 1 : 0;
    if (matrix[index]![6] === -1) matrix[index]![6] = index % 2 === 0 ? 1 : 0;
  }
  for (let index = 0; index < 9; index += 1) {
    if (matrix[index]![8] === -1) matrix[index]![8] = 0;
    if (matrix[8]![index] === -1) matrix[8]![index] = 0;
  }
  for (let index = 0; index < 8; index += 1) {
    matrix[8]![size - index - 1] = 0;
    matrix[size - index - 1]![8] = 0;
  }
  matrix[size - 8]![8] = 1;
  if (version >= 7) {
    const bits = getBchTypeNumber(version);
    for (let index = 0; index < 18; index += 1) {
      const bit = (bits >>> index) & 1;
      const row = Math.floor(index / 3);
      const column = index % 3;
      matrix[row]![column + size - 11] = bit;
      matrix[column + size - 11]![row] = bit;
    }
  }
}

function drawFinderPattern(matrix: number[][], centerRow: number, centerColumn: number): void {
  for (let row = -4; row <= 4; row += 1) {
    for (let column = -4; column <= 4; column += 1) {
      const distance = Math.max(Math.abs(row), Math.abs(column));
      const targetRow = centerRow + row;
      const targetColumn = centerColumn + column;
      if (targetRow < 0 || targetRow >= matrix.length || targetColumn < 0 || targetColumn >= matrix.length) continue;
      matrix[targetRow]![targetColumn] = distance !== 2 && distance !== 4 ? 1 : 0;
    }
  }
}

function drawAlignmentPattern(matrix: number[][], centerRow: number, centerColumn: number): void {
  for (let row = -2; row <= 2; row += 1) {
    for (let column = -2; column <= 2; column += 1) {
      const distance = Math.max(Math.abs(row), Math.abs(column));
      matrix[centerRow + row]![centerColumn + column] = distance !== 1 ? 1 : 0;
    }
  }
}

function alignmentPatternCenters(version: number): number[] {
  if (version === 1) return [];
  const last = version * 4 + 10;
  const count = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((last - 6) / (count * 2 - 2)) * 2;
  return [6, ...Array.from({ length: count - 2 }, (_, index) => last - step * (count - 2 - index)), last];
}

function drawCodewords(matrix: number[][], codewords: Uint8Array, mask: number): void {
  const size = matrix.length;
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let index = 0; index < size; index += 1) {
      const row = upward ? size - 1 - index : index;
      for (let offset = 0; offset < 2; offset += 1) {
        const column = right - offset;
        if (matrix[row]![column] !== -1) continue;
        const bit = bitIndex < codewords.length * 8
          ? (codewords[Math.floor(bitIndex / 8)]! >>> (7 - (bitIndex % 8))) & 1
          : 0;
        bitIndex += 1;
        matrix[row]![column] = bit ^ (maskApplies(mask, row, column) ? 1 : 0);
      }
    }
    upward = !upward;
  }
}

function maskApplies(mask: number, row: number, column: number): boolean {
  switch (mask) {
    case 0: return (row + column) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return column % 3 === 0;
    case 3: return (row + column) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0;
    case 5: return (row * column) % 2 + (row * column) % 3 === 0;
    case 6: return ((row * column) % 2 + (row * column) % 3) % 2 === 0;
    default: return ((row + column) % 2 + (row * column) % 3) % 2 === 0;
  }
}

function drawFormatBits(matrix: number[][], mask: number): void {
  const data = mask;
  let remainder = data << 10;
  while (remainderBitLength(remainder) - remainderBitLength(0x537) >= 0) remainder ^= 0x537 << (remainderBitLength(remainder) - remainderBitLength(0x537));
  const bits = ((data << 10) | remainder) ^ 0x5412;
  const size = matrix.length;
  for (let index = 0; index < 15; index += 1) {
    const bit = (bits >>> index) & 1;
    if (index < 6) matrix[index]![8] = bit;
    else if (index < 8) matrix[index + 1]![8] = bit;
    else matrix[size - 15 + index]![8] = bit;
    if (index < 8) matrix[8]![size - index - 1] = bit;
    else if (index < 9) matrix[8]![15 - index - 1 + 1] = bit;
    else matrix[8]![15 - index - 1] = bit;
  }
}

function remainderBitLength(value: number): number {
  return value === 0 ? 0 : 32 - Math.clz32(value);
}

function getBchTypeNumber(value: number): number {
  let remainder = value << 12;
  while (remainderBitLength(remainder) - remainderBitLength(0x1f25) >= 0) remainder ^= 0x1f25 << (remainderBitLength(remainder) - remainderBitLength(0x1f25));
  return (value << 12) | remainder;
}

function qrPenalty(matrix: number[][]): number {
  const size = matrix.length;
  let penalty = 0;
  for (let row = 0; row < size; row += 1) penalty += linePenalty(matrix[row]!);
  for (let column = 0; column < size; column += 1) penalty += linePenalty(matrix.map((row) => row[column]!));
  for (let row = 0; row < size - 1; row += 1) {
    for (let column = 0; column < size - 1; column += 1) {
      const value = matrix[row]![column];
      if (value === matrix[row + 1]![column] && value === matrix[row]![column + 1] && value === matrix[row + 1]![column + 1]) penalty += 3;
    }
  }
  let dark = 0;
  matrix.forEach((row) => row.forEach((value) => { if (value === 1) dark += 1; }));
  penalty += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  return penalty;
}

function linePenalty(line: number[]): number {
  let penalty = 0;
  let runColor = line[0];
  let runLength = 1;
  for (let index = 1; index < line.length; index += 1) {
    if (line[index] === runColor) {
      runLength += 1;
      continue;
    }
    if (runLength >= 5) penalty += 3 + runLength - 5;
    runColor = line[index];
    runLength = 1;
  }
  if (runLength >= 5) penalty += 3 + runLength - 5;
  for (let index = 0; index <= line.length - 11; index += 1) {
    const pattern = line.slice(index, index + 11).join('');
    if (pattern === '10111010000' || pattern === '00001011101') penalty += 40;
  }
  return penalty;
}
