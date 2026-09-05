// Static "Terms and Conditions" content — Pages 2, 3 and 4 of the signed RDK
// Vehicle Rental Agreement — appended after the Agreement's own Page 1 (see
// rentalAgreement.js: generateRentalAgreementPdf calls appendTermsAndConditionsPages
// once the Page 1 form is drawn). This is fixed legal boilerplate, not derived
// from booking data, so every generated invoice carries the identical 3
// pages. Page groupings mirror the paper agreement exactly (clauses 1-7 on
// page 2, 8-16 on page 3, 17-30 on page 4) so "Page X of 4" matches the
// signed copy — do not reorder or split clauses across pages without also
// updating a newly signed reference agreement.
//
// Two deliberate simplifications versus the paper original: the single-word
// underlines on "NOT" (clause 17) and "any" (the paragraph after clause
// 16(h)) are not reproduced — jsPDF has no built-in way to underline one word
// inside an auto-wrapped paragraph without hand-splitting every line, and
// omitting it doesn't change the clause's meaning or content.

const navy = [15, 23, 42];
const slate = [40, 40, 40];

const DEFINITIONS = [
  { letter: "a.", text: "OWNER - means RDK TRADING Pte Ltd is successors-in-title, affiliates, subsidiaries, partners & assigns" },
  { letter: "b.", text: "RENTER - means the person(s) signing this agreement, any other person or entity to which the charges incurred under this agreement are to be billed, and any ADDITIONAL DRIVER shown on the first page of this Agreement or otherwise permitted to drive the vehicle with the written consent of the OWNER." },
  { letter: "c.", text: "VEHICLE - means the motor vehicle or any substitute or replacement vehicle described in this Agreement and/or other Form of Records, includes all tires, tools, accessories, equipment, keys, parts and vehicle documents in or on the vehicle." },
];

const DISCLAIMER = "THE TERMS AND CONDITIONS FOR RENTAL MENTIONED ON THE FOLLOWING PAGES FORM AN INTEGRAL PART OF THIS VEHICLE RENTAL CONTRACT. ANY BREACH OF THESE TERMS & CONDITIONS RESULTS IN THE RENTER HAVING UNLIMITED SOLE LIABILITY FOR ALL CLAIMS AND DAMAGES. BY SIGNING THIS CONTRACT, THE RENTER CONFIRMS HAVING READ THE TERMS AND CONDITIONS FOR RENTAL AND OF GIVING HIS UNCONDITIONAL APPROVAL TO THE STIPULATIONS OF THE TERMS AND CONDITIONS FOR RENTAL";

// Page 2: clauses 1-7 (7 carries sub-items a-l; (i) is bold in the signed copy).
const PAGE2 = [
  { num: "1.", text: "The RENTER acknowledges that the VEHICLE is the property of the OWNER and that the VEHICLE is in perfect running condition. The RENTER is under obligation to return the VEHICLE together with all tires, tools, accessories and equipment on the pre-arranged date - earlier if the OWNER requests - in as good order and condition as the VEHICLE was when collected by the RENTER from the OWNER. The RENTER will be held fully responsible for any, but not limited to, vehicular accident, damages, loss, fire, flood or theft caused to the VEHICLE." },
  { num: "2.", text: "The person(s) signing the Contract assumes full personal responsibility, jointly and severally with the firm, person or organization, the driver or all substitute drivers in whose name he/they might sign and ensure they have a valid driving license to drive the appropriate class of vehicle in the Republic of Singapore." },
  { num: "3.", text: "The RENTER shall ensure that the Vehicle shall not at any time during the Rental Period be driven by any person other than by the RENTER or an ADDITIONAL DRIVER and shall procure that the ADDITIONAL DRIVER complies with the terms and conditions of this Agreement as if an original party hereto. The RENTER will be solely responsible for any non-compliance by the ADDITIONAL DRIVER with the terms and conditions of this Agreement and that the RENTER shall indemnify the OWNER for any and all claims (including third party claims), actions, proceedings, demands, liabilities, losses, damages, costs (including legal costs on an indemnity basis) and expenses of whatever nature, arising directly out of or in connection the acts or omissions of the ADDITIONAL DRIVER." },
  { num: "4.", text: "No relaxation, forbearance or indulgence by the OWNER in enforcing any of the terms and conditions of this Agreement shall prejudice or affect the rights and powers of the OWNER." },
  { num: "5.", text: "This agreement and VEHICLE cannot be assigned or transferred by RENTER. The RENTER remains responsible regardless of any attempted assignment. This agreement shall be governed by and is construed in accordance with the laws of Republic of Singapore." },
  {
    num: "6.", text: "Arising out of any breach by the RENTER of any of the terms and conditions of this Agreement;",
    subs: [
      { letter: "(a)", text: "The RENTER shall pay the OWNER on demand all losses and damages suffered by the OWNER arising out of any breach by the RENTER of any terms and conditions of this Agreement including, but not limited to any loss or damage suffered by the OWNER from the OWNER's loss of use or loss of the VEHICLE for any reason whatsoever." },
      { letter: "(b)", text: "The RENTER shall pay on demand all costs and expenses (including legal costs on a Solicitor and Client basis) incurred by or on behalf of the OWNER for taking any legal proceedings to enforce the provisions of this Agreement." },
      { letter: "(c)", text: "The RENTER shall at all times indemnify and keep indemnified the OWNER and shall save and keep the OWNER harmless against all losses, damages, claims, penalties, liabilities and expenses including legal costs however arising or incurred by the OWNER." },
      { letter: "(d)", text: "The OWNER may terminate the Agreement with immediate effect with no refund of deposit and compensation for the remaining days" },
      { letter: "(e)", text: "The entire deposit placed by the RENTER shall be forfeited at the sole discretion of the OWNER" },
    ],
  },
  {
    num: "7.", text: "The RENTER agrees to take proper care of the VEHICLE and to drive the same in a careful and skilful manner observing the traffic regulations and laws and in the event of any breach thereof, the RENTER shall pay all fines and penalties which may be incurred and shall also answer all Police and Traffic Court Summonses, including all notices and inquiries in connection therewith. In particular the RENTER is to ensure with all reasonable care that;",
    subs: [
      { letter: "(a)", text: "The VEHICLE must not be overloaded;" },
      { letter: "(b)", text: "At all times the VEHICLE must be provided with sufficient fuel from petrol stations only, engine oil, coolant, prescribed tire pressure and legal tyre condition;" },
      { letter: "(c)", text: "When not in use the VEHICLE must be properly parked and locked." },
      { letter: "(d)", text: "The VEHICLE shall not be used to carry passengers or property for hire or reward" },
      { letter: "(e)", text: "The VEHICLE shall not be used for the purpose of giving driving lessons" },
      { letter: "(f)", text: "The VEHICLE shall not be used to carry passengers in excess of the capacity thereof or the limit for which the VEHICLE is licensed" },
      { letter: "(g)", text: "The VEHICLE shall not be used, operate or drive the VEHICLE under the influence of any intoxicating substance or liquid; or any drug" },
      { letter: "(h)", text: "The VEHICLE must not be used to push, propel or tow another vehicle, trailer or any other thing without the written permission of the OWNER" },
      { letter: "(i)", text: "The VEHICLE shall not be used, or allow the use of the VEHICLE, contrary to any law, rule or regulations in force in Singapore for any illegal purpose or transporting contraband items, or in any manner by which the VEHICLE might become liable to seizure, confiscation or forfeiture", bold: true },
      { letter: "(j)", text: "The VEHICLE shall not be used for any race, race test, contest, competition or for any purpose other than a domestic one" },
      { letter: "(k)", text: "The RENTER agrees not to do or allow or cause anything to be done, or omit to do, allow or cause anything to be done, whereby the OWNER's Standard vehicle insurance policy shall no longer be effective." },
      { letter: "(l)", text: "The RENTER agrees not to permit the VEHICLE to be operated by any other person without the written permission of OWNER. A penalty of S$ 5000.00 is payable by the RENTER to the OWNER in the event any other person apart from the RENTER is found to be driving the VEHICLE or engine failure due to negligence or not adhering to warning signs on the dashboard by the RENTER." },
    ],
  },
];

// Page 3: clauses 8-16, plus the unnumbered closing paragraph after 16(h).
const PAGE3 = [
  { num: "8.", text: "The full rental cost calculated on the basis of the daily rental charge is payable in advance on delivery of the VEHICLE to the RENTER. At the expiration of this rental contract, i.e. when the VEHICLE is returned to the location indicated in this Contract, any additional rental charges, which may have been incurred, shall become due for immediate payment. Late charge of S$ 54.50 applies for each instance of late rental payment past each due date & time and for extension." },
  { num: "9.", text: "The refundable security deposit specified by the OWNER from time to time, is payable by the RENTER to the OWNER on delivery of the VEHICLE. Deposit may not be used to set off any part of any relevant rental fee due and owing. The OWNER shall be entitled to deduct from the said deposit at its discretion and without notice to the RENTER any amount due or owed by the RENTER to the OWNER. The refundable security deposit will be forfeited in the event of early termination or cancellation of the rental contract and in the event of any accident. The refundable deposit will be refunded via bank credit within two (2) working days from the date the VEHICLE is returned to the OWNER, save for the conditions mentioned." },
  { num: "10.", text: "The RENTER agrees that this agreement terminates upon the End Date specified above. Notwithstanding anything to the contrary in this Agreement or any Exhibits, the OWNER may terminate this Agreement prior to the End Date without any notice. In the event the Agreement is terminated prior to the End Date or extended End Date, the OWNER will not compensate or refund for the remaining days or hours or extensions." },
  { num: "11.", text: "In the event that the VEHICLE is not returned to the OWNER and keys not handed over to the OWNER at the End Time as stated in the front page hereof in the same original condition, a late fee of S$ 54.50 will be imposed for every fifteen (15) minutes, or part thereof, from the End Time. If the VEHICLE is still not returned to the OWNER twelve (12) hours from the End Time, a Police Report will be lodged against the RENTER for theft of the VEHICLE." },
  { num: "12.", text: "Fuel is at the RENTER's expense. All VEHICLES must be returned with the same amount of fuel as at the time of delivery. In the event the RENTER does not return at the same fuel level, the OWNER will be authorized to charge S$ 40.00 for every block of ¼ or less fuel level and this amount will be deducted from the RENTER's deposit with an additional administrative charge of S$ 54.50. There is no refund for excess fuel returned." },
  { num: "13.", text: "The VEHICLE can only be used as a Private Hire Vehicle with the written permission of the OWNER. The RENTER shall ensure they possess a valid Private Hire Car Driver's Vocational License (PDVL) and LTA-issued tamper-evident decals are always displayed on the VEHICLE. The RENTER shall be charged S$ 109.00 for each damaged or tampered decal. Private Hire VEHICLE Rentals are subjected to a minimum of one (1) month's rental contract with early termination resulting in the forfeiture of the deposit and payment of 50% of rental charges for the remaining contract period by the RENTER to the OWNER. Late charge of S$ 54.50 is chargeable for each instance of late rental payment past each due date & time. One (1) weeks' notice must be given prior to return of VEHICLE for rentals with contracts that have ended." },
  { num: "14.", text: "The RENTER expressly agrees to pay the OWNER on demand all time and mileage surcharges, minimum or other charges applicable to this rental at rates or in the amount specified herein and in the current tariff published by the OWNER and in addition, a sum equal to the amount or cost of all loss and damage to or in connection with the said VEHICLE during the rental period. The RENTER hereby assigns to the OWNER any and all damage and insurance claims, which he may have in this connection and agrees that the same be paid directly to the OWNER." },
  { num: "15.", text: "All extensions of rental periods will be on the exact same Terms and Conditions as set out in this Agreement and can only be extended if duly authorised and approved by the OWNER" },
  {
    num: "16.", text: "The VEHICLE is insured under a standard motor vehicle insurance policy in accordance with laws of Singapore covering liability of the RENTER, and ADDITIONAL DRIVER as stated in the front page hereof for whom an additional charge has been paid in full prior by the RENTER, in respect of third-party damages, injury or death. The RENTER agrees to protect the interest of the OWNER and the Insurer in the event of accident by;",
    subs: [
      { letter: "(a)", text: "obtaining names and addresses of all parties involved and of witnesses and not admitting liability or guilt or entering into a settlement with any third party without advance notice to the OWNER and taking photographs of the accident scene and all accident vehicles before moving the VEHICLE;" },
      { letter: "(b)", text: "not abandoning the VEHICLE without adequate provisions for safeguarding and securing same;" },
      { letter: "(c)", text: "notifying the OWNER immediately within 1 hour of such accidents and submitting a duly completed Motor Accident Report Form with Excess payment within 24 hours of such accidents, failing which the insurance coverage shall lapse and the RENTER shall have an unlimited liability for all claims in respect of the accident;" },
      { letter: "(d)", text: "delivering to the OWNER all correspondence, Writs or documents of any kind received by the RENTER relating to any accident involving the VEHICLE while rented under the Agreement;" },
      { letter: "(e)", text: "comply with all requests by the OWNER to provide assistance in any litigation or investigation of such accident." },
      {
        letter: "(f)", text: "The RENTER shall be subject to following Excess for each Accident or each Claim from any incidents involving the VEHICLE and is payable in full immediately to the OWNER upon an Accident or Claim regardless of which party is at fault and is non-refundable even if the claim amount is lower than the Excess:",
        dashes: [
          { type: "dash", text: "Above 24 to less than 65 years old AND above 2 years driving license:" },
          { type: "sub", segs: [{ text: "Third Party Excess S$ 5270", bold: true }, { text: " / ", bold: false }, { text: "Own Damage Excess S$ 6360", bold: true }] },
          { type: "dash", text: "Less than 24 or above 65 years old AND/OR less than 2 years driving license:" },
          { type: "sub", segs: [{ text: "Third Party Excess S$ 8540", bold: true }, { text: " / ", bold: false }, { text: "Own Damage Excess S$ 9630", bold: true }] },
          { type: "dashMixed", segs: [{ text: "In West Malaysia: ", bold: false }, { text: "Additional Third-Party Excess S$ 4180", bold: true }, { text: " / ", bold: false }, { text: "Additional Own Damage Excess S$ 4180", bold: true }] },
          { type: "dash", text: "In case of write-off or total loss of vehicle (e.g. beyond economical repair), theft, fire or flood the non-waivable Own Damage Excess will be set to S$10900" },
        ],
      },
      { letter: "(g)", text: "Insurance excess only covers the bodywork of the vehicle and RENTER will be liable for the loss of use subject to duration required for repair. RENTER is required to pay for the Loss of Rental from the time of accident until the time the VEHICLE is repaired and returned to the OWNER." },
      { letter: "(h)", text: "The RENTER is liable to pay the OWNER an administration fee of $ 1045 for any accident or incident involving the VEHICLE" },
    ],
  },
  { type: "para", text: "If the RENTER fails to do the necessary as stated in clause 14 or RENTER breaches any of the terms and conditions of this Agreement, OWNER and the Insurer may exercise their right to repudiate any claims as they deem appropriate and the RENTER shall have an unlimited liability for all claims in respect of the accident. For the avoidance of doubt, any Own Damage Excess and/or Third-Party Excess payable herein is in addition to (and not in lieu or in substitution of) any Additional Fees or any other fees that may be payable by RENTER to OWNER under these Terms and Conditions or otherwise." },
];

// Page 4: clauses 17-30 (no sub-items).
const PAGE4 = [
  { num: "17.", text: "The VEHICLE is NOT covered by a policy of insurance covering personal injuries to or death of the RENTER or the passengers of the VEHICLE. The OWNER or its Insurer shall not under any circumstances be liable to make any payment to the RENTER or the passengers of the VEHICLE in respect of or to indemnify the RENTER against any loss, injury or damage sustained by the RENTER arising out of the use of the VEHICLE or as a result of any defect therein. The RENTER shall be solely responsible. The RENTER has to arrange for his own insurance in these aspects. Upon taking delivery of the VEHICLE, the RENTER shall be deemed to have satisfied himself that it is in all respects road worthy and in a proper and safe condition." },
  { num: "18.", text: "The OWNER cannot be held responsible for any damages, not covered by insurance, to the RENTER and any third party in connection with the operation and the rented VEHICLE as well as the loss or damage to articles stored or left in the VEHICLE during the rental period. The RENTER agrees to exonerate the OWNER from all responsibility in connection with any loss or damage or inconvenience caused by the belated delivery of the VEHICLE to the RENTER, possible motor troubles or any other causes." },
  { num: "19.", text: "The RENTER shall not take the VEHICLE outside the Republic of Singapore and shall keep the VEHICLE at all times in his possession and custody and not part with its possession or custody to any other person. If for any reason, the VEHICLE is taken out of Singapore without the prior permission or written consent of the OWNER, the RENTER shall be held liable and fully responsible for all cost and expenses including but not limited to damages, repairs, towing fee, fines or claims of any nature. In the event that written consent of the OWNER is obtained to take the VEHICLE to West Malaysia, the RENTER will still be liable and compensate the OWNER for damages, theft, fire or flood of the VEHICLE but not limited to any loss or damage suffered by the OWNER from the OWNER's loss of use or loss of the VEHICLE for any reason whatsoever. The RENTER shall be held liable and fully responsible for all cost and expenses for ensuring the VEHICLE is brought back to Singapore in the event the VEHICLE breaks down in West Malaysia including but not limited to damages, repairs, towing fee, fines or claims of any nature. A penalty of S$ 3270.00 is to be payable by the RENTER to the OWNER for unauthorised use of the VEHICLE outside of Singapore without the written permission of the OWNER." },
  { num: "20.", text: "If the VEHICLE is not returned to the OWNER and keys not handed over to the OWNER on the due date & time as stated in the front page hereof or if the RENTER is in breach of any of the terms of this Agreement the OWNER shall be entitled to repossess the VEHICLE at the RENTER's expense at any time without giving him prior notice and the RENTER hereby irrevocably authorize the OWNER, its servants or agents to enter into and unto any premises in which the VEHICLE may be in order to repossess the same without being liable to any actions or proceedings at the suit of the RENTER or any persons claiming under or through him. OWNER will not be liable for the loss of any personal belongings of the RENTER in the course of repossession and the RENTER will remain liable for any damage to the Vehicle at the point of repossession. An administrative charge of S$ 3270.00 is to be payable by the RENTER to the OWNER for each instance of VEHICLE repossession." },
  { num: "21.", text: "Punctured tires, empty petrol tank, flat battery, loss of VEHICLE key, broken VEHICLE key or key locked inside of VEHICLE does not constitute a breakdown. In the event that the Service from the OWNER is called upon to respond to such occurrence or any other incidence where there is no fault with the VEHICLE or mechanical issue with the VEHICLE, the RENTER shall pay a service charge of S$163.50 per trip plus the cost of replacing the parts to the OWNER." },
  { num: "22.", text: "Smoking or Vaping is strictly not allowed in the interior of the VEHICLE at all times. The RENTER has to take steps to ensure smoke does not enter the interior of the vehicle at all times. If determined by the OWNER that there is odour of smoke or ash in the VEHICLE interior, a cleaning of charge S$ 163.50 will be charged to the RENTER." },
  { num: "23.", text: "The RENTER is to return the VEHICLE in a clean and pleasant condition upon the end of the rental period. If the VEHICLE is found to be dirty, contaminated, or with bird droppings, insects, pet odour or pet fur, a cleaning of charge S$ 163.50 will be charged to the RENTER." },
  { num: "24.", text: "In the event of a VEHICLE breakdown or repair, rental rebate will be granted only for the time above 6 hours spent in the workshop. A replacement VEHICLE, which may be of a different Model, may also be provided, subject to availability. The OWNER shall not be held responsible for any consequential and incidental loss, i.e. income, fuel etc." },
  { num: "25.", text: "RENTER shall be required to take note of the Vehicle's engine temperature and bear all the costs and expenses which will be incurred to repair of the Vehicle in the event of any overheating of the Vehicle's engine which is attributable RENTER's acts, omissions and/or negligence. If there are any issues with the Vehicle due to wear and tear and/or a Vehicle breakdown, RENTER shall report such issues to OWNER immediately. RENTER must ensure that the Vehicle has reasonable amount of fuel from petrol stations only, engine oil, auto-transmission oil, coolant, prescribed tire pressure and legal tyre condition at all times." },
  { num: "26.", text: "At any point in time, either before, during or after the Rental Period, either before or after the Security Deposit is paid, if the RENTER is found to be blacklisted in the Blacklist database www.rentalblacklist.com.sg for whatsoever reason, the OWNER reserves the right to refuse, terminate or cancel any rental agreement with the RENTER with no refund of all sums of money paid by the RENTER to the OWNER, including but not limited to Rental Charges and refundable Security Deposit." },
  { num: "27.", text: "The RENTER shall be responsible for all Fines and Summons in relation to the VEHICLE issued by but not limited to LTA, SPF, URA, HDB, NEA, Sentosa. The RENTER shall pay and settle all Fines and Summons immediately. In the event the OWNER has to handle and furnish information for such Fines and Summons, the RENTER is liable to pay the OWNER an administration fee of $ 54.50 for each such Notice, Fine or Summon." },
  { num: "28.", text: "The RENTER is responsible for Electronic Road Pricing (ERP) fees during the operative hours and has to ensure sufficient funds are available in the appropriate Cashcard before passing an ERP gantry. The RENTER shall be responsible for all fines for non-payment of ERP fees." },
  { num: "29.", text: "The VEHICLE may be equipped with Tracking Hardware to locate the position of the VEHICLE. The RENTER shall not demand to remove the Tracking device from the VEHICLE and shall indemnify the OWNER free from all claims including but not limited to privacy act and allow the OWNER at any time to monitor the position of the VEHICLE. Any damage to the Tracking Hardware will be charged to the RENTER at $ 545." },
  { num: "30.", text: "The VEHICLE may be equipped with Engine Immobilizer System. If the RENTER is in breach of any of the terms of this Agreement, the OWNER reserve all its rights to immobilize the VEHICLE at any time without giving prior notice to the RENTER. The OWNER shall be entitled to repossess the VEHICLE at the RENTER's expense. Any mishap that may arise in enforcing it shall be under the full responsibility of the RENTER. And the RENTER shall at all times keep the OWNER fully indemnify against all claims whatsoever." },
];

export function appendTermsAndConditionsPages(doc, { pageWidth = 210, pageHeight = 297, margin = 13 } = {}) {
  const contentWidth = pageWidth - margin * 2;
  // Reserve room at the bottom of every T&C page for the "Accepted by Renter"
  // box + "Page X of 4" footer, so flowing clause text never runs into them.
  const bottomLimit = pageHeight - 32;
  const indentA = 5;   // hanging indent for lettered items: a./b./c. and (a)-(l)
  const subIndentA = indentA + 5;
  const indentB = 8;   // dash sub-bullets under clause 16(f)
  const lineH = 3.3;
  const fs = 7.5;

  let y;

  const setFont = (bold) => { doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(fs); doc.setTextColor(...slate); };

  const para = (text, { bold = false, indent = 0, gapAfter = 1.2 } = {}) => {
    setFont(bold);
    const lines = doc.splitTextToSize(text, contentWidth - indent);
    lines.forEach((line) => { doc.text(line, margin + indent, y); y += lineH; });
    y += gapAfter;
  };

  // Numbered clause: "1." at the margin, wrapped body hanging-indented under it.
  const hangingPara = (prefix, text, { bold = false, gapAfter = 1 } = {}) => {
    setFont(bold);
    const lines = doc.splitTextToSize(text, contentWidth - indentA);
    lines.forEach((line, i) => {
      if (i === 0) doc.text(prefix, margin, y);
      doc.text(line, margin + indentA, y);
      y += lineH;
    });
    y += gapAfter;
  };

  // Lettered sub-item: "(a)" indented once, wrapped body indented further.
  const subLine = (letter, text, { bold = false } = {}) => {
    setFont(bold);
    const lines = doc.splitTextToSize(text, contentWidth - subIndentA);
    lines.forEach((line, i) => {
      if (i === 0) doc.text(letter, margin + indentA, y);
      doc.text(line, margin + subIndentA, y);
      y += lineH;
    });
  };

  const dashLine = (text) => {
    setFont(false);
    const lines = doc.splitTextToSize(text, contentWidth - indentB - 3);
    lines.forEach((line, i) => {
      if (i === 0) doc.text("-", margin + indentB, y);
      doc.text(line, margin + indentB + 3, y);
      y += lineH;
    });
  };

  // One line built from bold/normal segments placed left-to-right — used for
  // the Excess figures (short enough to never need wrapping).
  const mixedLine = (segs, { indent = 0, dash = false } = {}) => {
    let x = margin + indent + (dash ? 3 : 0);
    if (dash) { setFont(false); doc.text("-", margin + indent, y); }
    segs.forEach((seg) => {
      doc.setFont("helvetica", seg.bold ? "bold" : "normal");
      doc.setFontSize(fs);
      doc.setTextColor(...slate);
      doc.text(seg.text, x, y);
      x += doc.getTextWidth(seg.text);
    });
    y += lineH;
  };

  // "This Agreement is subject to the following Terms and Conditions:" — the
  // whole line bold, with only the trailing clause underlined, matching the
  // signed copy.
  const introHeading = () => {
    setFont(true);
    const p1 = "This Agreement is subject to the following ";
    const p2 = "Terms and Conditions:";
    doc.text(p1, margin, y);
    const w1 = doc.getTextWidth(p1);
    doc.text(p2, margin + w1, y);
    const w2 = doc.getTextWidth(p2);
    doc.setLineWidth(0.25);
    doc.line(margin + w1, y + 0.8, margin + w1 + w2, y + 0.8);
    y += lineH + 1.5;
  };

  const renderClauseBlock = (c) => {
    if (c.type === "para") { para(c.text); return; }
    hangingPara(c.num, c.text, { gapAfter: (c.subs || c.dashes) ? 0.6 : 1 });
    (c.subs || []).forEach((s) => {
      subLine(s.letter, s.text, { bold: !!s.bold });
      (s.dashes || []).forEach((d) => {
        if (d.type === "dash") dashLine(d.text);
        else if (d.type === "sub") mixedLine(d.segs, { indent: indentB + 3 });
        else if (d.type === "dashMixed") mixedLine(d.segs, { indent: indentB, dash: true });
      });
    });
    y += 1;
  };

  // Flags (dev console only, never blocks generation) if a future edit to the
  // clause text pushes a page past the reserved signature-box zone — verified
  // empirically to sit ~25mm clear at the current font size/content.
  const warnIfOverflow = (pageNo) => {
    if (y > bottomLimit) {
      console.warn(`rentalTermsPdf: Terms & Conditions page ${pageNo} content runs into the signature box (y=${y.toFixed(1)}, limit=${bottomLimit}). Shrink font size or trim text.`);
    }
  };

  const sigBoxAndFooter = (pageNo) => {
    const boxW = 62, boxH = 22;
    const bx = pageWidth - margin - boxW;
    const by = pageHeight - 14 - boxH;
    doc.setDrawColor(...navy);
    doc.setLineWidth(0.3);
    doc.rect(bx, by, boxW, boxH);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...navy);
    doc.text("Accepted by Renter", bx + boxW / 2, by + 5, { align: "center" });
    doc.setDrawColor(90);
    doc.line(bx + 4, by + 11, bx + boxW - 4, by + 11);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...slate);
    doc.text("Name: ___________________", bx + 4, by + 15.5);
    doc.text("NRIC: ___________________", bx + 4, by + 20);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...slate);
    doc.text(`Page ${pageNo} of 4`, pageWidth / 2, pageHeight - 8, { align: "center" });
  };

  // ---------------- Page 2 ----------------
  doc.addPage();
  y = margin + 3;
  introHeading();
  setFont(true);
  doc.text("GENERAL DEFINITIONS", margin, y);
  y += lineH + 0.8;
  DEFINITIONS.forEach((d) => hangingPara(d.letter, d.text, { gapAfter: 0.5 }));
  y += 1.5;
  para(DISCLAIMER, { bold: true, gapAfter: 2 });
  PAGE2.forEach(renderClauseBlock);
  warnIfOverflow(2);
  sigBoxAndFooter(2);

  // ---------------- Page 3 ----------------
  doc.addPage();
  y = margin + 3;
  PAGE3.forEach(renderClauseBlock);
  warnIfOverflow(3);
  sigBoxAndFooter(3);

  // ---------------- Page 4 ----------------
  doc.addPage();
  y = margin + 3;
  PAGE4.forEach(renderClauseBlock);
  warnIfOverflow(4);
  sigBoxAndFooter(4);
}
