// ── MONTHS (for month-filter dropdowns) ─────────────────────────────────────
export const MONTHS = [
  { value: "2026-04", label: "April 2026" },
  { value: "2026-05", label: "May 2026" },
  { value: "2026-06", label: "June 2026" },
];

// ── SAMPLE DATA ──────────────────────────────────────────────────────────────
export const FLEET = [
  { plate:"SBA 1234 X", make:"Toyota", model:"Corolla", year:2022, color:"Silver", purchase:26000, insurance:1200, reg:1300, otherCharges:0, purchaseDate:"2022-01-15", maint:7.5, coe:"2026-07-15", status:"On Rental", minRate:null, maxRate:null, targetRate:null, runningDaysTarget:null, profitPctTarget:null },
  { plate:"SBC 5678 Y", make:"Honda",  model:"Civic",   year:2021, color:"White",  purchase:22000, insurance:1100, reg:1100, otherCharges:0, purchaseDate:"2021-03-10", maint:7.5, coe:"2028-03-20", status:"On Rental", minRate:null, maxRate:null, targetRate:null, runningDaysTarget:null, profitPctTarget:null },
  { plate:"SBD 9012 Z", make:"Mazda",  model:"3",       year:2023, color:"Blue",   purchase:29000, insurance:1400, reg:1600, otherCharges:0, purchaseDate:"2023-02-05", maint:7.5, coe:"2028-11-10", status:"On Rental", minRate:null, maxRate:null, targetRate:null, runningDaysTarget:null, profitPctTarget:null },
  { plate:"SBE 3456 A", make:"Nissan", model:"Sylphy",  year:2022, color:"Black",  purchase:24500, insurance:1200, reg:1100, otherCharges:0, purchaseDate:"2022-06-20", maint:7.5, coe:"2027-06-30", status:"Available", minRate:null, maxRate:null, targetRate:null, runningDaysTarget:null, profitPctTarget:null },
  { plate:"SBF 7890 B", make:"Toyota", model:"Vios",    year:2020, color:"Red",    purchase:19500, insurance:1000, reg:1000, otherCharges:0, purchaseDate:"2020-09-01", maint:9.0, coe:"2025-09-15", status:"Maintenance", minRate:null, maxRate:null, targetRate:null, runningDaysTarget:null, profitPctTarget:null },
  { plate:"SBG 1122 C", make:"Honda",  model:"Jazz",    year:2021, color:"Grey",   purchase:20500, insurance:1050, reg:950,  otherCharges:0, purchaseDate:"2021-08-22", maint:7.5, coe:"2026-08-22", status:"Available", minRate:null, maxRate:null, targetRate:null, runningDaysTarget:null, profitPctTarget:null },
  { plate:"SBH 3344 D", make:"Hyundai",model:"Elantra", year:2023, color:"White",  purchase:25000, insurance:1150, reg:1200, otherCharges:0, purchaseDate:"2023-01-05", maint:7.5, coe:"2029-01-05", status:"On Rental", minRate:null, maxRate:null, targetRate:null, runningDaysTarget:null, profitPctTarget:null },
  { plate:"SBI 5566 E", make:"Kia",    model:"Cerato",  year:2022, color:"Silver", purchase:23000, insurance:1100, reg:1050, otherCharges:0, purchaseDate:"2022-10-18", maint:7.5, coe:"2027-10-18", status:"Available", minRate:null, maxRate:null, targetRate:null, runningDaysTarget:null, profitPctTarget:null },
];

export const BOOKINGS = [];

export const EARNINGS = [];

export const EXPENSES = [];

export const ALERTS = [
  { id:1, type:"coe",     plate:"SBA 1234 X", car:"Toyota Corolla",  msg:"COE expires 15 Jul 2026",  days:18,  urgent:true },
  { id:2, type:"coe",     plate:"SBG 1122 C", car:"Honda Jazz",      msg:"COE expires 22 Aug 2026",  days:56,  urgent:false },
  { id:3, type:"return",  plate:"SBD 9012 Z", car:"Mazda 3",         msg:"Wang Li Xin — Return by 6 PM", days:0, urgent:true },
  { id:4, type:"booking", plate:"SBE 3456 A", car:"Nissan Sylphy",   msg:"Raj Kumar booking starts tomorrow", days:1, urgent:false },
  { id:5, type:"booking", plate:"SBF 7890 B", car:"Toyota Vios",     msg:"Under maintenance since Jun 10", days:17, urgent:false },
];