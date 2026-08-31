import { z } from "zod";

const money = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Enter a valid amount");

const optionalMoney = z.preprocess(
  (value) => (value === "" || value == null ? undefined : value),
  money.optional(),
);

export const curtainPricingSchema = z.object({
  adjustments: z.object({
    ultimate_from_essential_sgd: money,
    ultimate_from_pls_sgd: money,
    zen_default_sgd: money,
    zen_4m_sgd: money,
    zen_5m_sgd: money,
    s_fold_3m_sgd: money,
    s_fold_4m_sgd: money,
    s_fold_above_4m_sgd: optionalMoney,
    remove_day_sgd: money,
    remove_essential_sgd: money,
    remove_pls_sgd: money,
    add_day_sgd: money,
    add_essential_sgd: money,
    add_pls_sgd: money,
    blackout_per_m_sgd: money,
    slim_single_per_m_sgd: money,
    slim_double_per_m_sgd: money,
  }),
});

export const curtainPackageSchema = z
  .object({
    isNew: z.boolean(),
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1, "Enter a package name").max(120),
    property_tier_id: z.string().uuid("Select a property tier"),
    package_type: z.enum(["single", "double"]),
    base_tier: z.literal("essential"),
    price_sgd: money,
    tier2_upgrade_sgd: optionalMoney,
    room_tier2_upgrade_sgd: optionalMoney,
    room_tier2_downgrade_sgd: optionalMoney,
  })
  .superRefine((value, context) => {
    if (!value.isNew && !value.id) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "Package id is required when editing",
      });
    }
  });

export const blindPricingSchema = z.object({
  prices: z.array(
    z.object({
      property_tier_id: z.string().uuid(),
      family: z.enum([
        "venetian_roman_non_200",
        "roller",
        "combi",
        "roman_200",
      ]),
      price_sgd: optionalMoney,
    }),
  ),
});

export type CurtainPricingInput = z.infer<typeof curtainPricingSchema>;
export type BlindPricingInput = z.infer<typeof blindPricingSchema>;
export type CurtainPackageInput = z.infer<typeof curtainPackageSchema>;
