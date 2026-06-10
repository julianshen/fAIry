const $ = (id) => document.getElementById(id);
let selected = null;

$("search").addEventListener("click", () => {
  const flights = [
    { id: "FA101", price: 199 },
    { id: "FA205", price: 249 },
    { id: "FA320", price: 312 },
  ];
  const r = $("results");
  r.replaceChildren();
  flights.forEach((f, i) => {
    const b = document.createElement("button");
    b.id = `select-${i}`;
    b.textContent = `${f.id} — $${f.price}`;
    b.style.display = "block";
    b.style.width = "360px";
    b.style.height = "30px";
    b.addEventListener("click", () => { selected = f; $("book").style.display = "block"; });
    r.appendChild(b);
  });
});

$("book").addEventListener("click", () => {
  if (!selected) return;
  const ref = "FAIRY-" + selected.id.replace(/[^A-Z0-9]/g, "").padEnd(6, "0").slice(0, 6);
  $("confirmation").textContent = `Booked ${selected.id}. Reference ${ref}`;
});
