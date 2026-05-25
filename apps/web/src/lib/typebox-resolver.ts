import { Value } from '@sinclair/typebox/value'
import type { TSchema, Static } from '@sinclair/typebox'
import type { FieldValues, Resolver } from 'react-hook-form'

// Резолвер для react-hook-form поверх TypeBox. Использует те же схемы,
// что объявлены в Elysia-маршрутах, — без дубликатов и codegen.
// Static<T> расширяет FieldValues по контракту RHF (объект-форма).
export function typeboxResolver<TSchemaT extends TSchema>(
  schema: TSchemaT,
): Resolver<Static<TSchemaT> & FieldValues> {
  type Values = Static<TSchemaT> & FieldValues

  return async (values) => {
    const errors = [...Value.Errors(schema, values)]
    if (errors.length === 0) {
      return { values: values as Values, errors: {} }
    }
    const fieldErrors: Record<string, { type: string; message: string }> = {}
    for (const err of errors) {
      const key = err.path.replace(/^\//, '').replaceAll('/', '.') || '_root'
      fieldErrors[key] = { type: 'validation', message: err.message }
    }
    return { values: {} as Values, errors: fieldErrors as never }
  }
}
