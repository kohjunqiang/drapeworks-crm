import { sql, type Kysely } from "kysely";

// Phase 13C — the procurement values the sample purchase orders evidence.
//
// EVERY VALUE HERE IS TRANSCRIBED FROM `resource/documents/`, NOT AUTHORED.
// The three PDFs — `40 Omar 957B Tampines_{Day,Night,Blinds} PO.pdf` — are one
// real order sent to three vendors, and the strings below were read off them
// character by character. Nothing was translated, normalised or inferred.
//
// That is the whole discipline of this migration. These strings are read on a
// factory floor in Shenzhen. A plausible-looking Chinese term that nobody at
// the business actually chose is the same class of error as a plausible-looking
// dimension: it will be acted on, and the mistake surfaces as cut fabric.
//
// The consequence is that this seed is DELIBERATELY INCOMPLETE. Only four of
// the ten room types get a label, because only four appear in the samples. The
// other six block PO generation until an admin supplies them through the
// procurement settings screen. That refusal is the designed behaviour — it is
// the mechanism by which "do not invent the Chinese" is enforced at runtime
// rather than merely intended.
//
// Vendor details are NOT seeded, for the same reason. The samples name Rising
// (V005), ZhuYingTai (V006) and 顺金纺织窗材有限公司 / ShunJin Textile Pte Ltd
// (V007), but our `vendors` rows were created independently and matching them
// by name would be a guess about which supplier is which. The business fills
// these in on the vendors screen, where it can see both sides.

export async function up(db: Kysely<unknown>): Promise<void> {
  // ── procurement_settings ────────────────────────────────────────────────
  //
  // The letterhead and delivery block, identical on all three samples:
  //
  //     Drapeworks SG (UEN202609289G)
  //     60 Paya Lebar Road # 06-28
  //     Singapore 409051
  //     电话 : +65 8513 3236
  //     微信 : 130 6177 3305
  //     网站 : http://www.drapeworks.sg
  //
  //     收货地址 Delivery Address
  //     新加坡空运唛头： BCH-SG-AD76-空 (写在包装）
  //     仓库地址：广东省深圳市宝安区福洲大道同富路科聚通工业园D栋1楼102
  //     收件人：八戒-4207
  //     电话： 13750954207
  //
  // The 中文 labels themselves (电话, 收件人, 仓库地址…) are the renderer's
  // business, not data — they are part of the form. What is stored is only the
  // value each label introduces.
  //
  // air_shipping_mark is transcribed exactly as it prints, including the
  // half-width `(` against the full-width `）`. That asymmetry is in the
  // source document — a Chinese-IME half/full-width slip in the original
  // spreadsheet — and it is not ours to silently tidy: the mark is copied onto
  // packaging and matched by a forwarder, so it is a code, not prose. If the
  // business wants it normalised, that is a one-field edit on the admin screen.
  //
  // floor_clearance_cm is left NULL on purpose. All three samples print the
  // 窗帘离地 label and its 厘米 CM unit with NO NUMBER between them. We know the
  // field exists; we do not know its value, and a plausible 1 or 2 would be an
  // invention.
  await sql`
    insert into public.procurement_settings (
      singleton,
      company_name, company_uen, address_line1, address_line2,
      phone, wechat, website,
      air_shipping_mark, warehouse_address_cn, recipient_cn, delivery_phone,
      curtain_style_cn, heat_setting_cn, floor_clearance_cm
    ) values (
      true,
      'Drapeworks SG',
      'UEN202609289G',
      '60 Paya Lebar Road # 06-28',
      'Singapore 409051',
      '+65 8513 3236',
      '130 6177 3305',
      'http://www.drapeworks.sg',
      'BCH-SG-AD76-空 (写在包装）',
      '广东省深圳市宝安区福洲大道同富路科聚通工业园D栋1楼102',
      '八戒-4207',
      '13750954207',
      '韩式',
      '高温定型',
      null
    )
    on conflict (singleton) do nothing
  `.execute(db);

  // ── room_type_labels ────────────────────────────────────────────────────
  //
  // FOUR ROWS, AND FOUR IS THE COMPLETE SET OF WHAT THE SAMPLES EVIDENCE:
  //
  //     客厅 LR          (Night + Day PO)
  //     主卧 MB          (Night PO)
  //     次卧 1 BR1 / 次卧 2 BR2   (Night PO — 次卧 is "secondary bedroom")
  //     SR Service Yard  (Blinds PO)
  //
  // The trailing digits in `次卧 1 BR1` are NOT part of the label. They are
  // per-document numbering, applied at render time when a room type appears
  // more than once — the samples show a bare `客厅 LR`, never `LR1`.
  //
  // Balcony, Kitchen, Common Toilet, Master Toilet, Study Room and Other are
  // deliberately absent. They have no evidenced Chinese and generation refuses,
  // naming the missing room type, until the business supplies one.
  //
  // Service Yard's name_cn is the ENGLISH STRING 'Service Yard', and that is a
  // placeholder, not a translation. The Blinds sample prints `SR Service Yard`
  // with no Hanzi anywhere in the cell, so the Chinese term is genuinely
  // unknown to us. A not-null name_cn is required by the table, so this row
  // stores what the document actually says and waits to be corrected on the
  // admin screen. It is the one row here that a human should change.
  //
  // Note for whoever fills in the rest: `SR` is taken. The samples assign it to
  // Service Yard, so Study Room needs a different code — the obvious `SR` would
  // collide on exactly the kind of document where an ambiguous room code sends
  // the wrong curtain to the wrong window.
  await sql`
    insert into public.room_type_labels (room_type, name_cn, code) values
      ('Living Room',    '客厅',         'LR'),
      ('Master Bedroom', '主卧',         'MB'),
      ('Bedroom',        '次卧',         'BR'),
      ('Service Yard',   'Service Yard', 'SR')
    on conflict (room_type) do nothing
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Reversing a seed is the one place a delete is legitimate: these rows are
  // configuration this migration created, not a record of anything that
  // happened. Restricted to the four keys it inserted, so an admin's later
  // additions survive a reversal.
  await sql`
    delete from public.room_type_labels
     where room_type in ('Living Room','Master Bedroom','Bedroom','Service Yard')
  `.execute(db);
  await sql`delete from public.procurement_settings where singleton`.execute(db);
}
