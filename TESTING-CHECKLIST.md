# ERP Testing Checklist

Is checklist se aap sab features test kar sakte hain aur check karein ke sab theek hai ya nahi.

**Login:** Owner = `owner` / `owner123`

---

## 1) Login & Dashboard
- [ ] Owner username/password se login hota hai
- [ ] Dashboard khulta hai (Invoice Total, Outstanding, Cheques, Low Stock)
- [ ] Top-right me company name / "All Companies" dikhta hai
- [ ] Due/Overdue cheques ka alert dikhta hai
- [ ] Low stock items dikhte hain
- [ ] Booker leaderboard aur top items dikhte hain

## 2) Companies
- [ ] "+ New Company" se nayi company ban sakti hai
- [ ] Company switch karne par data badalta hai
- [ ] Company ka naam invoice ke top-center me aata hai

## 3) Invoice
- [ ] New Invoice kholen → company select karein
- [ ] Customer select karein (uska naam/address/phone/booker/discount dikhta hai)
- [ ] Items add karein (name ya SKU se search, Tab se nayi line)
- [ ] Qty × Rate = Amount theek aata hai
- [ ] Discount % auto apply hota hai (customer ke approved discount se)
- [ ] 2 payment accounts select ho sakte hain
- [ ] Preview → sab items/totals/accounts dikhte hain
- [ ] Confirm & Save → invoice save hoti hai
- [ ] Invoice detail → Download PDF → branded invoice aati hai
  - [ ] Logo top-left
  - [ ] Company name top-center
  - [ ] Items table, SUB-TOTAL, DISCOUNT, GRAND TOTAL
- [ ] Old Bill add ho sakta hai (opening balance)

## 4) Customers
- [ ] Naya customer bane (name, address, phone, category, discount, booker, companies)
- [ ] Customer edit hota hai
- [ ] Active/Inactive hota hai
- [ ] Customer detail me financial context (sales/recovered/outstanding) dikhta hai

## 5) Inventory / Products
- [ ] Naya product bane (SKU, rates, stock)
- [ ] Product edit hota hai
- [ ] Product delete/archive hota hai (history preserve)
- [ ] A-Z sorting aur search kaam karta hai
- [ ] Low stock red me dikhta hai

## 6) Recovery & Cheques
- [ ] Recovery workspace me open invoices/old bills dikhte hain
- [ ] Recovery enter hoti hai (2 accounts split bhi)
- [ ] Cheque record hota hai (number, bank, amount, due date)
- [ ] Cheque deposit → clear → outstanding kam hota hai
- [ ] Cheque bounce → outstanding waisa hi rehta hai
- [ ] Cheque edit / cancel hota hai

## 7) Users & Access
- [ ] "+ New User" khulta hai
- [ ] Full Access / Limited Access radio option hai
- [ ] Limited Access me per-company per-action checkboxes dikhte hain (view/add/edit/delete/approve/export)
- [ ] Naye user se login ho sakta hai (uske permissions ke hisab se)
- [ ] Disabled user login nahi kar sakta

## 8) Invoice Template
- [ ] Template page khulta hai (company details, accounts, colors, footer)
- [ ] Logo upload hota hai (JPEG/PNG)
- [ ] Preview PDF download hota hai (F-193 style)
- [ ] Save Template kaam karta hai

## 9) Reports
- [ ] Sales / Stock / Receivables / Cashflow / Expense / Booker / Item reports dikhte hain
- [ ] Report company filter hota hai
- [ ] Download PDF / Excel kaam karta hai
- [ ] Print kaam karta hai

## 10) Distribution Business
- [ ] Common Ops me expenses, payroll, logistics, assets hain
- [ ] Allocation Plans bante hain (total 100% hona zaroori)
- [ ] Profitability report dikhti hai (sales, margin, allocated cost, P/L)

---

## Result
- [ ] **SAB OK** ✅
- [ ] Kuch issues hain (niche likhein):

```
Issues / notes:
1.
2.
3.
```
