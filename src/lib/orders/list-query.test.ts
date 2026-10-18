import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from "kysely";
import { describe, expect, it } from "vitest";

import type { DB } from "@/lib/db/schema";
import { orderPagination, orderSearch } from "./list-query";

const db = new Kysely<DB>({ dialect: {
  createAdapter: () => new PostgresAdapter(),
  createDriver: () => new DummyDriver(),
  createIntrospector: (db) => new PostgresIntrospector(db),
  createQueryCompiler: () => new PostgresQueryCompiler(),
} });

function search(query: string) {
  return db.selectFrom("orders")
    .innerJoin("customers", "customers.id", "orders.customer_id")
    .select("orders.id").where((eb) => orderSearch(eb, query)).compile();
}

describe("order search", () => {
  it("treats repeated spaces, tabs and pasted nonbreaking spaces identically", () => {
    const normal = search("Mike Phua");
    for (const query of ["  Mike   Phua  ", "Mike\tPhua", "Mike\u00a0Phua"]) {
      expect(search(query)).toMatchObject({ sql: normal.sql, parameters: normal.parameters });
    }
    expect(normal.sql).toContain(") and (");
    expect(normal.parameters).toEqual([...Array(6).fill("%Mike%"), ...Array(6).fill("%Phua%")]);
  });

  it("binds input as values and does not interpret SQL wildcards or escapes", () => {
    const result = search("O'Brien_%\\");
    expect(result.sql).not.toContain("O'Brien");
    expect(result.parameters).toEqual(Array(6).fill("%O'Brien%"));
  });

  it("keeps every existing search field, including freight numbers", () => {
    const result = search("10080");
    for (const field of ["name", "mobile", "development", "display_id", "order_reference"]) {
      expect(result.sql).toContain(`"${field}" ilike`);
    }
    expect(result.sql).toContain("os.overseas_freight_number ilike");
  });
});

describe("order pagination", () => {
  it("makes orders after the first 50 reachable", () => {
    expect(orderPagination("1", 54)).toEqual({ page: 1, pages: 2, offset: 0, first: 1, last: 50 });
    expect(orderPagination("2", 54)).toEqual({ page: 2, pages: 2, offset: 50, first: 51, last: 54 });
  });
  it("clamps a stale page after filters reduce the result set", () => {
    expect(orderPagination("99", 3)).toEqual({ page: 1, pages: 1, offset: 0, first: 1, last: 3 });
    expect(orderPagination("2", 0)).toEqual({ page: 1, pages: 1, offset: 0, first: 0, last: 0 });
  });
  it.each([undefined, "-1", "0", "1.5", "oops", "Infinity", "9007199254740992"])("handles invalid page %s", (value) => {
    expect(orderPagination(value, 100).page).toBe(1);
  });
});
