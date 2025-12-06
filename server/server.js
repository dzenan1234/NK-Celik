const express = require('express');
const session = require('express-session');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const UserController = require('./userController');
const News = require('./news');
const FanShopItem = require('./fanshop');
const Purchase = require('./purchase');
const crypto = require('crypto');
const path = require('path');

const sessionSecret = crypto.randomBytes(64).toString('hex');

const app = express();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: true
}));

app.use((req, res, next) => {
  res.locals.cartItemCount = req.session.cart ? req.session.cart.length : 0;
  next();
});

// MongoDB Atlas connection
const url = 'mongodb+srv://ahmed:ahmed123@nkcelik.qj8oewc.mongodb.net/?retryWrites=true&w=majority&appName=NKCelik';
mongoose.connect(url)
  .then(() => console.log('Connected to MongoDB Atlas'))
  .catch(err => console.error('Error connecting to MongoDB Atlas', err));

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname)); // sve .ejs fajlove traži u rootu (server folder)

// Authentication routes
app.post('/register', UserController.register);
app.post('/login', UserController.login);
app.get('/logout', UserController.logout);

// Home page
app.get('/home', async (req, res) => {
  try {
    const { user } = req.session;
    const newsArticles = await News.find().sort({ date: -1 }).limit(3);
    const newsArticlesSmall = await News.find().sort({ date: -1 }).skip(3).limit(4);
    const firstFourFanShopItems = await FanShopItem.find().limit(4);
    res.render('home', { newsArticles, user, newsArticlesSmall, firstFourFanShopItems });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// Static pages
app.get('/tim', (req, res) => res.render('tim', { user: req.session.user }));
app.get('/staff', (req, res) => res.render('staff', { user: req.session.user }));
app.get('/kontakt', (req, res) => {
  const { user, error, successMessage } = req.session;
  res.render('kontakt', { user, error, successMessage });
});
app.get('/login', (req, res) => {
  const { user, error } = req.session;
  res.render('login', { user, error });
});

// News routes
app.get('/novosti', async (req, res) => {
  try {
    const newsArticles = await News.find().sort({ date: -1 }).limit(10);
    res.render('novosti', { newsArticles, user: req.session.user });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

app.get('/novosti/:title/:id', async (req, res) => {
  try {
    const newsArticle = await News.findById(req.params.id);
    const user = req.session.user; 
    if (!newsArticle) return res.status(404).send('News article not found');
    if (req.params.title !== newsArticle.title.toLowerCase().replace(/ /g, '-')) {
      return res.redirect(`/novosti/${newsArticle.title.toLowerCase().replace(/ /g, '-')}/${newsArticle._id}`);
    }
    res.render('novostiDetalji', { newsArticle, user });
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

// FanShop routes
app.get('/fanshop', async (req, res) => {
  const { user, error } = req.session;
  const firstFourFanShopItems = await FanShopItem.find().sort({ _id: 1 }).limit(4);
  res.render('fanshop', { user, error, firstFourFanShopItems });
});

app.get('/fanshop/:name/:id', async (req, res) => {
  try {
    const { user, error, successMessage } = req.session;
    const fanshopItem = await FanShopItem.findById(req.params.id);
    if (!fanshopItem) return res.status(404).send('Item not found');
    res.render('fanshopPurchase', { fanshopItem, user, error, successMessage });
  } catch (error) {
    res.status(500).send('Server Error');
  }
});

app.post('/add-to-cart', (req, res) => {
  if (!req.session.cart) req.session.cart = [];
  const { id, name, price, imageUrl, quantity, size, productCategory } = req.body; 
  const item = { _id: id, name, price, imageUrl, quantity, size, productCategory }; 
  req.session.cart.push(item);
  res.json({ success: true, cartItemCount: req.session.cart.length });
});

app.post('/delete-from-cart', (req, res) => {
  if (!req.session.cart) return res.json({ success: false });
  const index = req.body.index;
  if (index !== undefined && index >= 0 && index < req.session.cart.length) {
    req.session.cart.splice(index, 1);
    return res.json({ success: true });
  }
  return res.json({ success: false });
});

app.get('/cart-items', (req, res) => {
  const cart = req.session.cart || [];
  res.json({ cart });
});

app.post('/purchase-cart', async (req, res) => {
  try {
    const userId = req.session.user._id;
    const cart = req.session.cart || [];
    if (cart.length === 0) return res.status(400).send('Cart is empty');
    const purchasePromises = cart.map(item => new Purchase({
      userId,
      itemId: item._id,
      quantity: item.quantity,
      productCategory: item.productCategory
    }).save());
    await Promise.all(purchasePromises);
    req.session.cart = [];
    res.redirect('/profil');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// Profile
app.get('/profil', async (req, res) => {
  try {
    const { user, error, successMessage } = req.session;
    req.session.successMessage = null;
    if (!user) return res.redirect('/login');
    const purchases = await Purchase.find({ userId: user._id });
    const itemCounts = {};
    for (const purchase of purchases) {
      const item = await FanShopItem.findById(purchase.itemId);
      if (item) {
        if (itemCounts[item._id]) itemCounts[item._id].count += parseInt(purchase.quantity);
        else itemCounts[item._id] = {
          name: item.name,
          imageUrl: item.imageUrl,
          count: parseInt(purchase.quantity),
          productCategory: purchase.productCategory
        };
      }
    }
    const purchasedItems = Object.values(itemCounts);
    res.render('profil', { user, error, successMessage, purchasedItems, cartItemCount: req.session.cart ? req.session.cart.length : 0 });
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal Server Error');
  }
});

// Admin middleware
const isAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.type === 'admin') return next();
  res.redirect('/home'); 
};

// Admin routes
app.get('/admin', isAdmin, async (req, res) => {
  try {
    const { user, error, successMessage } = req.session;
    const newsItems = await News.find().sort({ date: -1 });
    const fanShopItems = await FanShopItem.find();
    res.render('admin', { user, error, successMessage, newsItems, fanShopItems });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

app.post('/admin', async (req, res) => {
  const { title, date, content, imageUrl } = req.body;
  const newsItem = new News({ title, date: new Date(date), content, imageUrl });
  await newsItem.save();
  res.redirect('/admin');
});

app.post('/delete-news/:id', async (req, res) => {
  await News.findByIdAndDelete(req.params.id);
  res.redirect('/admin');
});

app.post('/admin/fanshop/add', async (req, res) => {
  const { name, category, price, imageUrl } = req.body;
  const fanShopItem = new FanShopItem({ name, category, price, imageUrl });
  await fanShopItem.save();
  res.redirect('/admin');
});

app.post('/admin/fanshop/delete/:id', async (req, res) => {
  const item = await FanShopItem.findById(req.params.id);
  if (item) await FanShopItem.findByIdAndDelete(req.params.id);
  res.redirect('/admin');
});

// Single purchase route
app.post('/purchase/:itemId', async (req, res) => {
  const userId = req.session.user._id;
  const itemId = req.params.itemId;
  const purchase = new Purchase({ userId, itemId });
  await purchase.save();
  res.redirect('/profil');
});

// All items page
app.get('/sviartikli', async (req, res) => {
  const { categories } = req.query;
  const { user, error, successMessage } = req.session;
  let filter = {};
  if (categories) filter = { category: { $in: categories.split(',') } };
  const allCategories = await FanShopItem.distinct('category');
  const fanShopItems = await FanShopItem.find(filter);
  res.render('sviartikli', { fanShopItems, allCategories, user, error, successMessage });
});

// Export for Vercel
module.exports = app;
