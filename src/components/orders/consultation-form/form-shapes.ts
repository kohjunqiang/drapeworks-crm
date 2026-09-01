import type { RoomType } from "@/lib/db/schema";

// Narrow form shapes for the pieces of the consultation form that are shared
// between product lines.
//
// The curtain and mesh forms have identical `customer` and `order` halves but
// different line items (rooms[].windows vs rooms[].panels). A component that
// only touches the shared prefix should be typed to the prefix, not to one
// product's full schema — typing it OrderEditInput would make it lie about the
// mesh case, which is the whole reason these exist.

/** Everything above the line items: customer details + order meta. */
export type ConsultationShellShape = {
  customer: {
    name: string;
    mobile: string;
    email?: string;
  };
  order: {
    property_type?: "HDB" | "Condo" | "Landed" | "Commercial";
    development?: string;
    site_address?: string;
    unit_type?: string;
    move_in_date?: string;
    price_quoted_cents: number;
    deposit_cents: number;
    general_notes?: string;
    is_draft: boolean;
    freight_mode: "air" | "sea";
    channel: "standard" | "carousell";
    extra_install_cents: number;
    discount_bps: number;
    promo_label?: string;
    curtain_package_id?: string;
    curtain_package_tier: "essential" | "tier2";
    curtain_package_single_layer: "day" | "night";
    curtain_package_pricing_signature?: string;
  };
};

/** The room fields every product line has, whatever its line items are called. */
export type RoomShellShape = {
  rooms: {
    id?: string;
    type: RoomType;
    label: string;
    position: number;
  }[];
};
