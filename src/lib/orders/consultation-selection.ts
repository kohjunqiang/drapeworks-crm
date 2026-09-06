export type ConsultationProduct = "curtain" | "mesh";

export function consultationCustomerCookie(product: ConsultationProduct): string {
  return `drapeworks-consultation-customer-${product}`;
}
