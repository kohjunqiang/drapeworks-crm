import {describe,it,expect} from "vitest";
import {commercialDifferences} from "./differences";
import {normalizeCommercialInvoice} from "@/lib/quotations/commercial-invoice";
const document=()=>normalizeCommercialInvoice({invoice_id:"i",total:100,line_items:[{name:"Curtain",description:"Living room\nSheer",quantity:1,rate:100}]});
describe("invoice changed fields",()=>{
 it("omits insignificant whitespace and catalogue IDs assigned to manual items",()=>{const a=document(),b=document();b.lines[0].description="Living room  Sheer";b.lines[0].itemId="zoho-id";expect(commercialDifferences(a,b)).toEqual([]);});
 it("shows substantive same-total descriptions instead of an empty dialog",()=>{const a=document(),b=document();b.lines[0].description="Bedroom";expect(commercialDifferences(a,b)).toEqual([expect.objectContaining({field:"description",crm:"Living room\nSheer",zoho:"Bedroom"})]);});
 it("shows tax metadata changes even when tax totals agree",()=>{const a=document(),b=document();a.taxes=[{id:"gst-a",name:"GST",percent:"9",amountCents:0}];b.taxes=[{id:"gst-b",name:"GST",percent:"9",amountCents:0}];expect(commercialDifferences(a,b)).toEqual([expect.objectContaining({field:"Tax breakdown"})]);});
});
