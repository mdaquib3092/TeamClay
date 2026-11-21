// Operator-supplied input data for the two runs. Never used by the live
// mailbox, comparison snapshots or decision handlers.
export const runGuides={
  steel:{
    replies:[
      "MAT004: 53000/mt\nMAT006: 54000/mt\nGST: 18%\nFreight: 3000\nDelivery: 3 days\nPayment: 30 days net\nExclusions: none\nSpec: exact",
      "MAT004: 52700/mt\nMAT006: 53800/mt\nGST: 18%\nFreight: 6500\nDelivery: 5 days\nPayment: 50% advance, balance on delivery\nExclusions: none\nSpec: exact",
    ],
    pick:"V01",reason:"V01 is ₹1,534 cheaper delivered, offers 30-day credit and can deliver in three days.",
  },
  waterproofing:{
    replies:[
      "MAT020: 2500/pack\nGST: 18%\nFreight: 1000\nDelivery: 2 days\nPayment: 15 days net\nExclusions: none\nSpec: exact",
      "MAT020: 2400/pack\nGST: 18%\nFreight: 800\nDelivery: 8 days\nPayment: Advance\nExclusions: none\nSpec: exact",
    ],
    pick:"V10",reason:"V10 costs ₹3,068 more but offers two-day delivery. V16’s eight days miss the five-day site deadline.",
  },
};
