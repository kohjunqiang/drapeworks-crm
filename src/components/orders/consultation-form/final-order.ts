/** A full form submit finalizes an order; draft saving has a separate action. */
export function asFinalOrder<T extends { order: { is_draft: boolean } }>(
  values: T,
): T {
  return {
    ...values,
    order: { ...values.order, is_draft: false },
  };
}
