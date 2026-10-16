window.P2_SEED = (function () {
  const SCHOOL = {
    name: "Plus Two High School",
    campus: "Bushenyi",
    fullName: "Plus Two High School — Bushenyi",
    motto: "COMBINE EFFORT",
    platform: "DutyDesk",
    poBox: "P.O. Box 282, Bushenyi",
    email: "plustwohighsch@gmail.com",
    termLabel: "Term III, 2026",
    termCode: "2026-T3"
  };

  const RAW = [
    "Atuhaire Joan","Tumwine Micheal","Atukwatse Racheal","Nareeba Amos","Keinemukama Price",
    "Natukunda Meles","Mucunguzi Brian","Kamuganga Nicholas","Musinguzi Laurence","Mukasa James",
    "Mugabe Nicholas","Gumoshabe Gregory","Amanya Aban","Tumwesigye Robert","Turyatunga Elias",
    "Nuwasilima Leticia","Barigye Denis","Ayebare Betty","Kategaya Isaac","Abenaitwe Anthony",
    "Katende Kenneth","Akampwera Arc","Rwamango Alexson","Abaho Vicent","Mugisha Joseph",
    "Nuwatwiine Vererian","Twinamatsiko Duncan","Masika Brenda","Atuhe Allan","Nakibuule Juliet",
    "Ahabwe Dickson","Mwebembezi Actus","Bukombi Festo","Abimanya James","Oculi Joseph",
    "Tukamushaba Joventa","Magyezi Gerald","Abigaba Amanyire","Ashabahebwa Sheila"
  ];

  function slugify(name) {
    return name.toLowerCase().replace(/[^a-z\s]/g, "").trim().replace(/\s+/g, ".");
  }

  function buildStaff() {
    const extra = [
      { id: "kenneth", name: "Katende Kenneth John", username: "kenneth", role: "superadmin", title: "Developer · Super Admin" },
      { id: "headteacher", name: "Headteacher", username: "headteacher", role: "admin", title: "Headteacher" }
    ];
    const fromRota = RAW.map((name) => {
      const username = slugify(name);
      const isKenneth = username === "katende.kenneth";
      const isArch = username === "akampwera.arc";
      return {
        id: username, name, username,
        role: isKenneth || isArch ? "admin" : "teacher",
        title: isKenneth ? "Teacher · Admin" : isArch ? "Teacher Arch" : "Teacher"
      };
    });
    const seen = new Set();
    const all = [...extra];
    for (const p of fromRota) {
      if (seen.has(p.username)) continue;
      seen.add(p.username);
      all.push(p);
    }
    return all;
  }

  const WEEKS = [
    { id: "w1", week: 1, start: "2026-09-14", end: "2026-09-20", label: "14th – 20th September 2026",
      day: ["Atuhaire Joan","Tumwine Micheal","Atukwatse Racheal","Nareeba Amos","Keinemukama Price"],
      night: ["Natukunda Meles","Mucunguzi Brian","Kamuganga Nicholas","Musinguzi Laurence"] },
    { id: "w2", week: 2, start: "2026-09-21", end: "2026-09-27", label: "21st – 27th September 2026",
      day: ["Mukasa James","Mugabe Nicholas","Gumoshabe Gregory","Amanya Aban","Tumwesigye Robert","Turyatunga Elias","Nuwasilima Leticia"],
      night: ["Barigye Denis","Ayebare Betty","Kategaya Isaac","Abenaitwe Anthony","Katende Kenneth"] },
    { id: "w3", week: 3, start: "2026-09-28", end: "2026-10-04", label: "28th September – 4th October 2026",
      day: ["Akampwera Arc","Rwamango Alexson","Abaho Vicent","Mugisha Joseph","Nuwatwiine Vererian","Twinamatsiko Duncan","Masika Brenda"],
      night: ["Atuhe Allan","Nakibuule Juliet","Ahabwe Dickson","Mwebembezi Actus","Keinemukama Price"] },
    { id: "w4", week: 4, start: "2026-10-05", end: "2026-10-11", label: "5th – 11th October 2026",
      day: ["Bukombi Festo","Mucunguzi Brian","Musinguzi Laurence","Abimanya James","Oculi Joseph","Kategaya Isaac","Tukamushaba Joventa"],
      night: ["Magyezi Gerald","Nuwasilima Leticia","Katende Kenneth","Amanya Aban","Gumoshabe Gregory"] },
    { id: "w5", week: 5, start: "2026-10-12", end: "2026-10-18", label: "12th – 18th October 2026",
      day: ["Natukunda Meles","Kamuganga Nicholas","Mugabe Nicholas","Abigaba Amanyire","Ayebare Betty","Abenaitwe Anthony","Mwebembezi Actus"],
      night: ["Atuhaire Joan","Keinemukama Price","Twinamatsiko Duncan","Nareeba Amos","Mugisha Joseph"] },
    { id: "w6", week: 6, start: "2026-10-19", end: "2026-10-26", label: "19th – 26th October 2026",
      day: ["Barigye Denis","Tumwine Micheal","Rwamango Alexson","Gumoshabe Gregory","Ahabwe Dickson","Katende Kenneth","Ashabahebwa Sheila","Masika Brenda"],
      night: ["Mukasa James","Nakibuule Juliet","Tumwesigye Robert","Abimanya James","Kategaya Isaac"] },
    { id: "w7", week: 7, start: "2026-10-27", end: "2026-11-01", label: "27th October – 1st November 2026",
      day: ["Atuhe Allan","Nareeba Amos","Mucunguzi Brian","Musinguzi Laurence","Nuwatwiine Vererian","Tukamushaba Joventa"],
      night: ["Akampwera Arc","Ayebare Betty","Mugabe Nicholas","Turyatunga Elias","Abigaba Amanyire"] },
    { id: "w8", week: 8, start: "2026-11-02", end: "2026-11-08", label: "2nd – 8th November 2026",
      day: ["Magyezi Gerald","Keinemukama Price","Kamuganga Nicholas","Abaho Vicent","Mwebembezi Actus","Nuwasilima Leticia"],
      night: ["Bukombi Festo","Ashabahebwa Sheila","Gumoshabe Gregory","Oculi Joseph","Ahabwe Dickson"] },
    { id: "w9", week: 9, start: "2026-11-09", end: "2026-11-15", label: "9th – 15th November 2026",
      day: ["Atuhaire Joan","Amanya Aban","Abimanya James","Mugisha Joseph","Abenaitwe Anthony","Twinamatsiko Duncan","Nakibuule Juliet"],
      night: ["Natukunda Meles","Rwamango Alexson","Tumwine Micheal","Nuwatwiine Vererian","Mugabe Nicholas"] },
    { id: "w10", week: 10, start: "2026-11-16", end: "2026-11-22", label: "16th – 22nd November 2026",
      day: ["Mukasa James","Atukwatse Racheal","Abigaba Amanyire","Oculi Joseph","Kategaya Isaac","Ashabahebwa Sheila"],
      night: ["Barigye Denis","Tukamushaba Joventa","Nuwasilima Leticia","Abaho Vicent","Mucunguzi Brian"] },
    { id: "w11", week: 11, start: "2026-11-23", end: "2026-11-29", label: "23rd – 29th November 2026",
      day: ["Akampwera Arc","Ahabwe Dickson","Katende Kenneth","Turyatunga Elias","Ayebare Betty","Tumwesigye Robert"],
      night: ["Atuhe Allan","Masika Brenda","Musinguzi Laurence","Mugabe Nicholas"] }
  ];

  const PLANNER = [
    { id: "p1", date: "2026-09-10", title: "Beginning of Term 3 Administrators meeting", kind: "admin" },
    { id: "p2", date: "2026-09-11", title: "Beginning of Term III Staff meeting", kind: "staff" },
    { id: "p3", date: "2026-09-11", title: "Staff departmental meetings", kind: "staff" },
    { id: "p4", date: "2026-09-12", title: "Academic committee meeting", kind: "academic" },
    { id: "p5", date: "2026-09-14", title: "Reporting of students for 3rd term 2026", kind: "students" },
    { id: "p6", date: "2026-09-15", title: "Beginning of Term 3 lessons", kind: "academic" },
    { id: "p7", date: "2026-09-15", title: "Beginning of Post mock exams for S.4", kind: "exam" },
    { id: "p8", date: "2026-09-18", title: "1st House meeting (meetings every two weeks)", kind: "house" },
    { id: "p9", date: "2026-09-20", title: "Goat roasting — house cleaning winners; rice party for 1st runners-up; volleyball celebrations", kind: "celebration" },
    { id: "p10", date: "2026-09-23", title: "Rewarding winners of class cleaning", kind: "celebration" },
    { id: "p11", date: "2026-09-26", title: "Prefects orientation workshop", kind: "prefects" },
    { id: "p12", date: "2026-09-30", title: "Bursary meetings (September)", kind: "admin" },
    { id: "p13", date: "2026-09-28", title: "Senior Six first set of Post Mock exams", kind: "exam" },
    { id: "p14", date: "2026-10-01", title: "Academic facilitations for Senior 4 and Senior 6", kind: "academic" },
    { id: "p15", date: "2026-10-01", title: "Extra lessons in progress (Sept–Nov)", kind: "academic" },
    { id: "p16", date: "2026-10-05", title: "Dedication of candidates", kind: "ceremony" },
    { id: "p17", date: "2026-10-05", title: "Swearing and handover — incoming and outgoing prefects", kind: "prefects" },
    { id: "p18", date: "2026-10-08", title: "UNEB briefing for Senior Four", kind: "uneb" },
    { id: "p19", date: "2026-10-15", title: "Mid-term exams for Senior Five", kind: "exam" },
    { id: "p20", date: "2026-10-15", title: "Senior Six second set of Post Mock exams", kind: "exam" },
    { id: "p21", date: "2026-10-24", title: "Visitation day", kind: "parents" },
    { id: "p22", date: "2026-11-06", title: "UNEB briefing for Senior Six", kind: "uneb" },
    { id: "p23", date: "2026-11-17", title: "End of Term 3 exams for S.1, S.2, S.3 and S.5", kind: "exam" },
    { id: "p24", date: "2026-11-26", title: "End of Term 3 staff meeting", kind: "staff" },
    { id: "p25", date: "2026-11-27", title: "End of Term 3, 2026", kind: "admin" },
    { id: "p26", date: "2026-11-28", title: "End of Term Administrators meeting", kind: "admin" }
  ];

  return { SCHOOL, slugify, buildStaff, WEEKS, PLANNER };
})();
