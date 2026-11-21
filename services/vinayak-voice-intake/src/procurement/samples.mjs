// Hypothetical replies for the on-screen rehearsals, never vendor evidence.
export const samples = [
  { key:"cement", label:"Cement", title:"100 bags of PPC cement", vendors:["V05","V06"],
    starter:"DEMO RFQ | MAT010 100 bags | Tower 2 | need +14 | reply +3",
    replies:[
      "MAT010: 330/bag | GST: 18% | Freight: 1000 | Delivery: 2 days | Payment: 15 days credit | Exclusions: none | Spec: exact",
      "MAT010: 325/bag | GST: 18% | Freight: 400 | Delivery: 4 days | Payment: 50% advance | Exclusions: none | Spec: exact",
    ], pick:"V06", reason:"Lower landed cost; four-day delivery and the advance are acceptable for this sample." },
  { key:"steel", label:"Steel", title:"Two diameters of Fe500D rebar", vendors:["V01","V02"],
    starter:"DEMO RFQ | MAT004 4 mt; MAT006 2 mt | Podium slab | need +12 | reply +2",
    replies:[
      "MAT004: 54000/mt | MAT006: 55000/mt | GST: 18% | Freight: 2000 | Delivery: 3 days | Payment: 15 days credit | Exclusions: none | Spec: exact",
      "MAT004: 53500/mt | MAT006: 54500/mt | GST: 18% | Freight: 6500 | Delivery: 5 days | Payment: Advance | Exclusions: none | Spec: exact",
    ], pick:"V01", reason:"Lower landed total after freight, three-day delivery and credit terms." },
  { key:"waterproofing", label:"Waterproofing", title:"32 packs of waterproof coating", vendors:["V10","V16"],
    starter:"DEMO RFQ | MAT020 32 packs | Basement waterproofing | need +5 | reply +1",
    replies:[
      "MAT020: 2400/pack | GST: 18% | Freight: 1000 | Delivery: 2 days | Payment: 15 days credit | Exclusions: none | Spec: exact",
      "MAT020: 2350/pack | GST: 18% | Freight: 500 | Delivery: 7 days | Payment: Advance | Exclusions: none | Spec: exact",
    ], pick:"V10", reason:"Two-day delivery meets the five-day requirement; the cheaper seven-day offer does not." },
];
