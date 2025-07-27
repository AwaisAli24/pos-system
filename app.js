const express = require("express");
const pg = require("pg");
const methodOverride = require("method-override");
const dotenv = require('dotenv');
const bcrypt = require("bcrypt");
const session = require("express-session");

const PORT = 3000;

const app = express();
dotenv.config();

app.use(express.urlencoded());
app.use(methodOverride("_method"));
app.use(express.static("public"));
app.use(session({
  secret: "yourSecretKey",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));


const now = new Date();

const options = {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
};

const formattedDate = now.toLocaleString("en-US", options);

const db = new pg.Client({
  user: process.env.USER1,
  host: process.env.HOST,
  database: process.env.DATABASE,
  password: process.env.PASSWORD,
  port: Number(process.env.DBPORT),
});
db.connect();

function isLoggedIn(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    res.redirect("/login");
  }
}

function isAdmin(req, res, next) {
  if (req.session.user && req.session.user.isAdmin) {
    next();
  } else {
    res.send("Access denied: Admins only");
  }
}


// Inventory routes
app.get("/", (req, res) => {
  res.render("index.ejs");
});
app.get("/product/view",isAdmin ,async (req, res) => {
  const data = await db.query("Select * FROM products");
  let products = data.rows;
  products.sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  );
  res.render("index.ejs", { products, title: "Inventory" });
});
app.post("/product/add",isAdmin ,async (req, res) => {
  console.log(req.body);
  const { id, name, price, quantity } = req.body;
  const query = await db.query(
    "INSERT INTO products(id,name,price,quantity) VALUES($1,$2,$3,$4)",
    [id, name, price, quantity]
  );
  res.redirect("/product/view");
});
app.post("/product/quantity/add",isAdmin ,async (req, res) => {
  console.log(req.body);
  const id = req.body.id;
  const addedQuantity = parseInt(req.body.addedQuantity);
  const data = await db.query("SELECT * FROM products where id=$1", [id]);
  let newQuantity = parseInt(data.rows[0].quantity);
  console.log(newQuantity);
  newQuantity += addedQuantity;
  console.log(newQuantity);

  await db.query("UPDATE products SET quantity=$1 where id=$2", [
    newQuantity,
    id,
  ]);
  res.redirect("/product/view");
});
app.put("/product/:id",isAdmin ,async (req, res) => {
  const id = req.params.id;
  const { name, price, quantity } = req.body;
  const query = await db.query(
    "UPDATE products SET name=$1,price=$2,quantity=$3 WHERE id=$4",
    [name, price, quantity, id]
  );
  res.redirect("/product/view");
});
app.delete("/product/:id",isAdmin ,async (req, res) => {
  const id = parseInt(req.params.id);
  const query = await db.query("UPDATE products SET quantity=$1 WHERE id=$2", [
    0,
    id,
  ]);
  res.redirect("/product/view");
});
//Sale Routes

//Add Sale (Billing)
app.post("/billing/add",isLoggedIn ,async (req, res) => {
  console.log(req.body);

  let items = req.body["item[]"];
  let quantities = req.body["quantity[]"];
  let amount = req.body.total;

  if (!Array.isArray(items)) {
    items = [items];
  }
  if (!Array.isArray(quantities)) {
    quantities = [quantities];
  }

  for (const [index, item] of items.entries()) {
    let quantity = await db.query("SELECT * FROM products WHERE id=$1", [item]);

    await db.query("UPDATE products SET quantity=$1 where id=$2", [
      quantity.rows[0].quantity - parseInt(quantities[index]),
      item,
    ]);
  }

  let data = await db.query(
    "INSERT INTO sales(date,amount)VALUES($1,$2) RETURNING *",
    [formattedDate, parseInt(amount)]
  );

  let sale_id = data.rows[0].id;

  for (const [index, item] of items.entries()) {
    await db.query(
      "INSERT INTO sale_item(product_id, sale_id,quantity) VALUES ($1, $2, $3)",
      [item, parseInt(sale_id), parseInt(quantities[index])]
    );
  }

  res.redirect("/billing");
});
//Get all sale record
app.get("/sale/get",isAdmin ,async (req, res) => {
  const data = await db.query("SELECT * FROM sales");
  res.render("sales.ejs", { sales: data.rows, title: "Sales" });
});
//Get a specific sale record
app.get("/sale/get/:id",isAdmin ,async (req, res) => {
  const id = req.params.id;
  let data = await db.query("SELECT * FROM sale_item WHERE sale_id=$1", [id]);
  console.log(data.rows);

  let items = [];
  let quantity = [];
  for (const item of data.rows) {
    items.push(item.product_id);
    quantity.push(item.quantity);
  }
  products = [];
  for (const item of items) {
    data = await db.query("SELECT * FROM products WHERE id=$1", [item]);
    products.push(data.rows[0]);
  }
  data = await db.query("SELECT * FROM sales WHERE id=$1", [id]);
  amount = data.rows[0].amount;
  res.render("sale_item.ejs", {
    product: products,
    amount,
    quantity,
    title: "Sales",
  });
});
app.get("/billing",isLoggedIn ,async (req, res) => {
  let data = await db.query("SELECT * FROM products");
  res.render("billing.ejs", { products: data.rows, title: "Billing" });
});
// Dashboard
app.get("/dashboard",isLoggedIn ,async (req, res) => {
  const dailySale = await db.query(
    "SELECT SUM(amount),COUNT(id) FROM sales WHERE date >=CURRENT_DATE;"
  );
  const weeklySale = await db.query(
    "SELECT SUM(amount),COUNT(id) FROM sales WHERE date >= CURRENT_DATE - INTERVAL '7 days';"
  );
  const monthlySale = await db.query(
    "SELECT SUM(amount),COUNT(id) FROM sales WHERE date >= CURRENT_DATE - INTERVAL '30 days';"
  );
  const products = await db.query(
    "SELECT p.name, SUM(si.quantity) AS total_quantity_sold FROM sale_item si JOIN products p ON si.product_id = p.id GROUP BY si.product_id, p.name ORDER BY total_quantity_sold DESC LIMIT 10;"
  );
  const lessProducts = await db.query(
    "SELECT * FROM products ORDER BY quantity ASC LIMIT 10"
  );

  res.render("dashboard.ejs", {
    title: "Dashboard",
    daily: dailySale.rows[0],
    weekly: weeklySale.rows[0],
    monthly: monthlySale.rows[0],
    products: products.rows,
    lessProducts: lessProducts.rows
  });
});
app.get("/login",(req,res)=>{
  res.render("login.ejs",{title:"Login"})
});
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const result = await db.query("SELECT * FROM users WHERE username=$1", [username]);

  if (result.rows.length === 0) {
    return res.send("User not found");
  }

  const user = result.rows[0];

  const match = await bcrypt.compare(password, user.password);

  if (match) {
    req.session.user = {
      id: user.id,
      username: user.username,
      isAdmin: user.isadmin
    };
    return res.redirect("/dashboard");
  } else {
    return res.send("Invalid password");
  }
});
app.get("/seed",async(req,res)=>{
  const adminUsername = "admin";
  const userUsername = "user";

  const adminPassword = await bcrypt.hash("admin123", 10);
  const userPassword = await bcrypt.hash("user123", 10);

  try {
    // Check if already exists
    const existing = await db.query("SELECT * FROM users WHERE username IN ($1, $2)", [adminUsername, userUsername]);

    const usernames = existing.rows.map(row => row.username);

    if (!usernames.includes(adminUsername)) {
      await db.query("INSERT INTO users (username, password, isAdmin) VALUES ($1, $2, $3)", [adminUsername, adminPassword, true]);
      console.log("Admin seeded");
    }

    if (!usernames.includes(userUsername)) {
      await db.query("INSERT INTO users (username, password, isAdmin) VALUES ($1, $2, $3)", [userUsername, userPassword, false]);
      console.log("User seeded");
    }
  } catch (err) {
    console.error("Error seeding users:", err);
  }
});
app.get("/currentdaysale",async(req,res)=>{
  const data = await db.query("SELECT * FROM sales WHERE date >=CURRENT_DATE;");
  res.render("sales.ejs", { sales: data.rows, title: "Today's Sale" });
})
app.get("/weeksale",async(req,res)=>{
  const data = await db.query("SELECT * FROM sales WHERE date >= CURRENT_DATE - INTERVAL '7 days'");
  res.render("sales.ejs", { sales: data.rows, title: "7 Days sale" });
})
app.get("/monthsale",async(req,res)=>{
  const data = await db.query("SELECT * FROM sales WHERE date >= CURRENT_DATE - INTERVAL '30 days';");
  res.render("sales.ejs", { sales: data.rows, title: "Monthly sale" });
})
app.listen(PORT, () => {
  console.log(`Server listening at port ${PORT}`);
});