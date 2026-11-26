import type { CommercialInvoice } from "@/lib/quotations/commercial-invoice";

export function commercialDifferences(crm:CommercialInvoice,zoho:CommercialInvoice) {
  const changes:Array<{item:string;field:string;crm:string;zoho:string}>=[];
  const remaining=[...zoho.lines];
  for(const left of crm.lines){const index=remaining.findIndex(right=>(left.itemId&&right.itemId)?left.itemId===right.itemId:left.name===right.name);const right=index<0?null:remaining.splice(index,1)[0];
    if(!right){changes.push({item:left.name,field:"Item",crm:`${left.quantity} × ${(left.rateCents/100).toFixed(2)}`,zoho:"Not present"});continue;}
    for(const field of ["itemId","name","description","quantity","rateCents","discountCents","totalCents","taxId","taxPercent"] as const){if(field==="itemId"&&(!left.itemId||!right.itemId))continue;const a=String(left[field]??""),b=String(right[field]??"");if((field==="description"?a.trim().replace(/\s+/g," "):a)===(field==="description"?b.trim().replace(/\s+/g," "):b))continue;changes.push({item:left.name,field:field.replace("Cents", " (SGD)"),crm:field.endsWith("Cents")?(Number(a)/100).toFixed(2):a,zoho:field.endsWith("Cents")?(Number(b)/100).toFixed(2):b});}
  }
  for(const right of remaining)changes.push({item:right.name,field:"Item",crm:"Not present",zoho:`${right.quantity} × ${(right.rateCents/100).toFixed(2)}`});
  for(const field of ["totalCents","taxCents","shippingCents","adjustmentCents","documentDiscountCents"] as const)if(crm[field]!==zoho[field])changes.push({item:"Invoice totals",field:field.replace("Cents"," (SGD)"),crm:(crm[field]/100).toFixed(2),zoho:(zoho[field]/100).toFixed(2)});
  const taxText=(document:CommercialInvoice)=>document.taxes.map(tax=>`${tax.id??"No ID"} · ${tax.name} · ${tax.percent??"?"}% · ${(tax.amountCents/100).toFixed(2)}`).sort().join("\n");
  if(taxText(crm)!==taxText(zoho))changes.push({item:"Invoice taxes",field:"Tax breakdown",crm:taxText(crm)||"None",zoho:taxText(zoho)||"None"});
  return changes;
}
