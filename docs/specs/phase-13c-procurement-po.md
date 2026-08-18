# Phase 13C — Procurement PO (采购订单)

**Status:** implemented 2026-08-18. Document generation verified end to end against the real samples; the storage upload and the interactive dialogs are unverified (see the plan's Task 8). Open items in §8 remain — most labels are still NULL and generation refuses until the business supplies them.
**Date:** 2026-08-18
**Depends on:** Phase 13B (manufacturing measurements), Phase 9 (vendors), Phase 12 (blinds)
**Source documents:** `resource/documents/40 Omar 957B Tampines_{Day,Night,Blinds} PO.pdf`

---

## 1. Why

Confirming an order's manufacturing measurements freezes what the vendor is to
build. Today that is where it stops: somebody then retypes those numbers into a
purchase order by hand, in Chinese, per vendor, and sends it on. That is the
last unrecorded transcription step in the whole flow, and it is the one that
lands on a cutting table.

This phase generates the PO from the frozen measurements.

## 2. What a PO is

Read the three sample PDFs before implementing. They are one real order —
Omar, Tampines 957B — split into three documents. Structure below is taken from
them, not invented.

### 2.1 One PO per vendor

The filenames say Day / Night / Blinds, but that is a coincidence of this order:
each of those products came from a different vendor.

| Document | Vendor | Internal Ref |
|---|---|---|
| Day PO | ZhuYingTai | V006 |
| Night PO | Rising | V005 |
| Blinds PO | 顺金纺织窗材有限公司 / ShunJin Textile Pte Ltd | V007 |

**The split is by vendor.** `curtain_series.vendor_id` already groups this way,
so an order whose day and night curtains share a vendor produces ONE PO with
both on it — which is correct, and is what the vendor wants. Do not split by
product type.

### 2.2 Header — identical on all three

```
                          采购订单 (PO)

Drapeworks SG (UEN202609289G)          DATE          08 August 2026
60 Paya Lebar Road # 06-28             PO #          10040
Singapore 409051                       INVOICE REF
电话 : +65 8513 3236                    CUST REF      Omar Tampines 957B 08-146
微信 : 130 6177 3305
网站 : http://www.drapeworks.sg
```

The company block is our own and is constant. `PO #` is **the same on all three
documents of one order** — it identifies the order, not the document.

### 2.3 Vendor and delivery blocks

```
供应商 Vendor                      收货地址 Delivery Address
ZhuYingTai                        新加坡空运唛头： BCH-SG-AD76- 空 ( 写在包装）
北联 2 楼 2348 室                   仓库地址：广东省深圳市宝安区福洲大道同富路
电话： 13750954207                    科聚通工业园 D 栋 1 楼 102
Internal Ref: V006                收件人：八戒 -4207
                                  电话： 13750954207
```

The delivery block is **air-freight specific** — 空运唛头 means "air shipping
mark", and the mark itself ends in 空 (air). `orders.freight_mode` is already
`air | sea`, so this block is conditional on it. The sea equivalent is not in
the samples and is an open item (§8).

### 2.4 Order details — curtains only

```
订单资料 Order Details
窗帘款式： 韩式          (style)
定型：    高温定型       (heat setting)
窗帘褶皱： 2 倍          (fullness)
窗帘离地： ___ 厘米 CM   (clearance from floor)
```

**Blank on the Blinds PO** — every one of these four labels is present but
unfilled there. They are curtain-only, confirmed by the samples and by the user.

`2 倍` is `pricing_assumptions.style_multiplier` (20000 bps = 2.0). The other
three are open items (§8).

### 2.5 The table

Curtains:

| 房间 Room | 窗帘款式 Type | 型号 Fabric | 面料米数 ( 米） Fabric Length (M) | 窗宽 ( 米） Width (M) | 窗高 （米） Height (M) | 开法 Opening |
|---|---|---|---|---|---|---|
| 客厅 LR | 窗帘 Night | 清风麻 -2 | 5.48 | 2.74 | 2.55 | 对开 Double draw |
| 主卧 MB | 窗帘 Night | 清风麻 -2 | 6.04 | 3.02 | 2.55 | 对开 Double draw |
| 次卧 1 BR1 | 窗帘 Night | 清风麻 -2 | 5.10 | 2.55 | 2.56 | 对开 Double draw |
| 次卧 2 BR2 | 窗帘 Night | 清风麻 -2 | 4.98 | 2.49 | 2.54 | 对开 Double draw |

Blinds — same shape, but the fourth column changes:

| 房间 Room | 窗帘款式 Type | 型号 Fabric | **平方（米） SQM (M)** | 窗宽 Width (M) | 窗高 Height (M) | 开法 Opening |
|---|---|---|---|---|---|---|
| SR Service Yard | 卷帘 | 1079-13 | 2.46 | 2.05 | 1.20 | 要罩盒 - with cover |

### 2.6 The arithmetic — verified against every sample row

- **Dimensions are METRES to 2 decimal places**, not centimetres. `mfg_width_cm / 100`.
- **Curtains: 面料米数 = width(m) × fullness.** 2.74 × 2 = 5.48 ✓, 3.02 × 2 = 6.04 ✓, 2.55 × 2 = 5.10 ✓, 2.49 × 2 = 4.98 ✓
- **Blinds: 平方 = width(m) × height(m).** 2.05 × 1.20 = 2.46 ✓

Widths and heights come from `manufacture_measurements.mfg_width_cm` /
`mfg_height_cm` — the frozen figures, never the measured ones. That is the whole
point of Phase 13B.

> **Rounding.** Compute in integer centimetres, divide by 100 for display, and
> round the derived columns to 2dp at the very end. Never round a dimension
> before multiplying, or a 2-decimal fabric length will disagree with the width
> beside it on the page and the vendor will query it.

### 2.7 Footer

```
<-- add rows as needed
备注
以上是成品尺寸，等待供应商开单确认
Wait for Vendor confirmation & invoice
```

`以上是成品尺寸` means "the above are FINISHED sizes" — which is exactly what a
frozen manufacturing measurement is. Keep this line; it is the sentence that
tells the vendor not to apply their own allowance on top of ours.

The Night sample also carries a free-text row, `都要绑带` ("all need tie-backs"),
between the last line and the footer. Per-PO notes are needed (§3.5).

---

## 3. Data model

### 3.1 PO number — reuse `order_reference`

Per the user: the PO number is `orders.order_reference`. It already exists, is
already unique, is already editable by ops and admin, and is already deliberately
still editable after the order locks — which now reads as foresight rather than
an arbitrary choice.

**A PO cannot be generated without one.** Generation refuses, naming the order,
rather than emitting a document with a blank PO number.

### 3.2 Vendors gain their real details

`vendors` currently holds `name`, `notes`, `is_active`. Add:

```sql
alter table public.vendors
  add column internal_ref text,          -- V005, V006, V007
  add column name_cn text,               -- 顺金纺织窗材有限公司
  add column address_cn text,            -- 北联 2 楼 2348 室
  add column phone text;                 -- 13750954207
```

`name_cn` is separate from `name` because the ShunJin PO prints both lines. When
`name_cn` is null only the Latin name prints, which is what the ZhuYingTai and
Rising samples do.

**Values are not in this spec** — the user supplies them through the vendors
admin screen. A vendor with no `internal_ref` still generates a PO; the line is
simply omitted.

### 3.3 Company and delivery settings

One row, like `pricing_assumptions`. These are company facts, not per-order:

```sql
create table public.procurement_settings (
  singleton boolean primary key default true check (singleton),
  company_name text not null,
  company_uen text not null,
  address_line1 text not null,
  address_line2 text not null,
  phone text not null,
  wechat text not null,
  website text not null,
  -- Delivery block. Air only: 空运唛头 is an AIR shipping mark and the mark
  -- itself ends in 空. Sea is an open item.
  air_shipping_mark text,        -- BCH-SG-AD76- 空 ( 写在包装）
  warehouse_address_cn text,     -- 广东省深圳市宝安区…
  recipient_cn text,             -- 收件人：八戒 -4207
  delivery_phone text,           -- 13750954207
  -- Curtain-only order details (§2.4)
  curtain_style_cn text,         -- 韩式
  heat_setting_cn text,          -- 高温定型
  floor_clearance_cm integer,    -- 窗帘离地
  updated_at timestamptz not null default now()
);
```

Admin-only write, authenticated read, seeded from the sample header. Editable on
a new tab under Admin.

### 3.4 Room names in Chinese

The table's first column is `客厅 LR` — a Chinese name AND a Latin code. Rooms
that repeat are numbered: `次卧 1 BR1`, `次卧 2 BR2`.

`room_type` is an English enum with no Chinese and no codes, and **it has no
`Service Yard`**, which the Blinds sample uses. Add the value, and add a lookup:

```sql
alter type public.room_type add value 'Service Yard';

create table public.room_type_labels (
  room_type public.room_type primary key,
  name_cn text not null,     -- 客厅
  code text not null         -- LR
);
```

A table rather than a hardcoded map, because these are factory-facing strings
that the business must be able to correct without a deploy.

> **DO NOT INVENT THE CHINESE.** Only five mappings are evidenced by the samples:
> Living Room → 客厅 LR · Master Bedroom → 主卧 MB · Bedroom → 次卧 BR ·
> Service Yard → SR · (Study Room is unknown, and note it cannot also be `SR`).
> The rest must be supplied by the user before shipping. A guessed Chinese term
> on a factory instruction is the same class of error as a guessed dimension.
> This is the existing "catalogue labels are stored verbatim" rule applied to
> room names.

Numbering (`BR1`, `BR2`) is derived at render time: within one PO, rooms sharing
a `room_type` are numbered by `rooms.position`, and a type appearing once is
**not** numbered — the samples show bare `LR` and `MB`, not `LR1`.

### 3.5 Per-PO notes

`都要绑带` sits in the table as a free row. Add `manufacture_pos.notes` (§3.6) so
ops can attach a line per vendor document.

### 3.6 The generated document

```sql
create table public.manufacture_pos (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  vendor_id uuid references public.vendors(id),
  po_number text not null,          -- snapshot of order_reference at generation
  storage_path text not null,
  notes text,
  superseded_at timestamptz,        -- set when an amendment regenerates
  generated_at timestamptz not null default now(),
  generated_by uuid references public.profiles(id)
);
```

**Superseded, never deleted** — an amendment (Phase 13B §13) regenerates, and the
document the vendor already has must remain retrievable. This is the no-hard-deletes
rule applied to the thing a factory is working from.

`po_number` is snapshotted because `order_reference` stays editable after lock;
the document must keep saying what it said when it was sent.

---

## 4. Generation

### 4.1 When

On confirm, **after the transaction commits** — never inside it.

Per the user: if generation fails the confirmation still succeeds. The
measurements freeze and the order moves to `sent_to_vendor` regardless, and the
frozen screen offers a **Regenerate** action. A font-loading failure or a missing
vendor detail must never block production; the order is real either way, and a
document can be produced a minute later.

The confirm dialog gains a line saying the PO will be generated.

### 4.2 How

`@react-pdf/renderer`, as decided in Phase 13 §15: declarative layout, renders
server-side, paginates a variable-length table without special handling.

**Chinese glyphs require an embedded CJK font.** The default Helvetica cannot
render 采购订单 and will emit blanks or tofu. Register a subsetted CJK font
(e.g. Noto Sans SC) at module load. Verify a rendered PDF actually shows the
characters before calling this done — a silently blank cell is the failure mode
here, and it looks fine in code review.

### 4.3 Storage and delivery

Private Supabase Storage bucket, path `pos/{order_id}/{po_id}.pdf`. Signed URL on
demand. Download on desktop; on mobile the Web Share API with the file attached,
which surfaces WeChat as a target — the vendors are reached on WeChat, and
`微信` is on the letterhead.

---

## 5. Validation

Generation refuses, naming what is missing, when:

- the order is not at `sent_to_vendor` or later (nothing is frozen yet)
- `order_reference` is empty (there would be no PO number)
- a room type in the order has no `room_type_labels` row
- `procurement_settings` has not been filled in

A vendor missing `internal_ref`, `name_cn`, `address_cn` or `phone` does **not**
block: those lines are omitted. They are contact details, not instructions.

## 6. Tests

Pure logic only, per the project's node-environment Vitest setup:

| Area | Cases |
|---|---|
| Unit conversion | 274 cm → `2.74`; 255 → `2.55`; a value needing 2dp padding renders `2.50` not `2.5` |
| Fabric length | width × fullness at 2.0 reproduces all four sample rows exactly |
| SQM | 2.05 × 1.20 = 2.46, matching the Blinds sample |
| Rounding order | derive from centimetres, round once at the end; a case where rounding first would disagree |
| Vendor grouping | day and night sharing a vendor produce ONE PO; three vendors produce three |
| Room numbering | two Bedrooms → BR1, BR2; one Living Room → `LR`, not `LR1` |
| Missing data | absent `order_reference` refuses; absent vendor phone omits the line and still renders |
| Freight | `sea` omits the air shipping mark block |

## 7. Out of scope

- Editing a PO after generation. Correct the measurements via amend, then regenerate.
- Emailing or WeChat-ing the PO from the app. It is downloaded and shared by hand.
- INVOICE REF — blank on two samples and `0` on the third; it is filled in later, off-system.
- The `[ 42]` cell in the samples' footer, which appears to be a spreadsheet artefact rather than content.

## 7b. Storage runs as service-role, and why

The PO upload and the signed-URL download both use the service-role client, not
the user's session.

The role `authenticated` holds **no grants on any table in `public`**, and
`is_admin()` / `is_ops()` are not `SECURITY DEFINER`. So any storage policy
evaluated as that role fails — first on `permission denied for table rooms`,
because the room-photos INSERT policy on `storage.objects` is permissive and
Postgres evaluates it whichever bucket you are writing to, and past that on
`profiles` via `is_admin()`. The PO upload was the first code in the app to
actually run as `authenticated`, which is why nothing had hit this before.

Authorization is unaffected: `requireRole(["ops","admin"])` on the action is the
gate, which is how access control actually works in this codebase today.
`sweepPhotoStorage` already reaches for the same client for the same reason.

The bucket's own policies are left in place — dormant, but correct for the day
the grants are fixed. **Making RLS real is its own piece of work**: it needs a
non-owner database role with explicit grants, and a `SECURITY DEFINER` audit of
`is_admin`, `is_ops`, `is_consultant`, `sync_order_current_status` and
`validate_status_transition`. See the header of
`data/migrations/202608181300_lock_blocks_delete.ts`.

## 8. Open items — must be answered before implementing

1. **Vendor details** for each vendor: `internal_ref`, `name_cn`, `address_cn`, `phone`.
   The samples give three (V005 Rising, V006 ZhuYingTai, V007 ShunJin); the rest are unknown.
2. **窗帘款式 (韩式), 定型 (高温定型), 窗帘离地** — fixed for every curtain order,
   or chosen per order? The user believes curtain-only and is confirming.
   Modelled as company settings above, which is the cheaper assumption to reverse.
3. **Sea freight delivery block.** The samples are all air. What replaces 空运唛头
   when `freight_mode = 'sea'`?
4. **Chinese room names and codes** for every `room_type` except the five evidenced above.
5. **Chinese type labels** beyond those evidenced: 纱窗 Day, 窗帘 Night, 卷帘 (roller).
   Roman, Venetian and Korean Combi blinds are unknown.
6. **开法 Opening** — 对开 is Double draw and 要罩盒 is a blind cover option.
   Single Left and Single Right are unknown, and whether "with cover" is a blind
   field we need to start storing.
