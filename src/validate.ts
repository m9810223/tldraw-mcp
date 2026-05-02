import {
  createBindingValidator,
  createShapeValidator,
  defaultBindingSchemas,
  defaultShapeSchemas,
} from '@tldraw/tlschema';
import type { TLRecord } from './store.js';

const shapeValidators = new Map<string, ReturnType<typeof createShapeValidator>>();
const bindingValidators = new Map<string, ReturnType<typeof createBindingValidator>>();

function getShapeValidator(type: string) {
  let v = shapeValidators.get(type);
  if (v) return v;
  const schema = (defaultShapeSchemas as Record<string, { props: Record<string, unknown> }>)[type];
  if (!schema) throw new Error(`Unknown shape type: ${type}`);
  v = createShapeValidator(type, schema.props as never);
  shapeValidators.set(type, v);
  return v;
}

function getBindingValidator(type: string) {
  let v = bindingValidators.get(type);
  if (v) return v;
  const schema = (defaultBindingSchemas as Record<string, { props: Record<string, unknown> }>)[type];
  if (!schema) throw new Error(`Unknown binding type: ${type}`);
  v = createBindingValidator(type, schema.props as never);
  bindingValidators.set(type, v);
  return v;
}

export function validateShape(record: TLRecord): void {
  if (record.typeName !== 'shape') return;
  const type = record.type as string;
  try {
    getShapeValidator(type).validate(record);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Shape validation failed (type=${type}, id=${record.id}): ${msg}`);
  }
}

export function validateBinding(record: TLRecord): void {
  if (record.typeName !== 'binding') return;
  const type = record.type as string;
  try {
    getBindingValidator(type).validate(record);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Binding validation failed (type=${type}, id=${record.id}): ${msg}`);
  }
}
