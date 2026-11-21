// Intake definitions only. Commercial replies and expected results are never
// inserted into a case; they must arrive in that case's invited email threads.
export const fieldRuns = [
  {key:"steel",label:"Steel",site:"Podium slab - Bay 2",need:12,reply:2,vendors:["V01","V02"],
    lines:[{code:"MAT004",name:"16 mm Fe500D rebar",requested:6,unit:"mt",referenceStock:0},
      {code:"MAT006",name:"25 mm Fe500D rebar",requested:2,unit:"mt",referenceStock:0}]},
  {key:"waterproofing",label:"Waterproofing",site:"Basement lift pit",need:5,reply:1,vendors:["V10","V16"],
    lines:[{code:"MAT020",name:"Brushbond RFX waterproof coating",requested:36,unit:"pack",referenceStock:12}]},
];
export const runCommand=r=>`RFQ RUN ${r.key.toUpperCase()}`;
export const runFields=r=>[r.lines.map(l=>`${l.code} ${l.requested} ${l.unit}`).join("; "),r.site,`need +${r.need}`,`reply +${r.reply}`];
export const findRun=key=>fieldRuns.find(r=>r.key===key);
