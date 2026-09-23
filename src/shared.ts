type TypedArray = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array;

/**
 * A copy of the object whose typed arrays are backed by SharedArrayBuffers, so posting it to a worker thread shares the
 * memory rather than copying it. Other properties are copied as they are.
 */
export function share<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).map(([key, property]) => [
    key,
    ArrayBuffer.isView(property) && !(property instanceof DataView) ? shareArray(property as TypedArray) : property
  ])) as T;
}

export function shareArray<T extends TypedArray>(array: T): T {
  if (array.buffer instanceof SharedArrayBuffer) {
    return array;
  }

  const Type = array.constructor as new (buffer: SharedArrayBuffer) => T;
  const shared = new Type(new SharedArrayBuffer(array.byteLength));

  shared.set(array as never);

  return shared;
}
