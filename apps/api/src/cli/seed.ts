/**
 * Seed data.
 *   pnpm db:seed                    → Super Admin, Admin, tax rates and sample phone accessories
 *   node dist/cli/seed.js           → the same, on the shop computer (no dev tools needed)
 *   SEED_MODE=minimal pnpm db:seed  → only the two accounts and tax rates (for a real shop)
 * Passwords and PINs can be set with SEED_SUPERADMIN_PASSWORD / SEED_SUPERADMIN_PIN /
 * SEED_ADMIN_PASSWORD / SEED_ADMIN_PIN (the defaults below are for development only).
 * Does nothing if the database already has users.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { makeInternalEan13 } from '@shoppos/shared';
import { PrismaClient } from '../generated/prisma/client';
import { hashSecret } from '../modules/auth/password';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const minimal = process.env.SEED_MODE === 'minimal';

/** Small deterministic random generator, so every seed gives the same stock numbers. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const rand = rng(42);
const pick = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
/** Rupees → cents, rounded to the nearest Rs 10. */
const rs = (rupees: number) => Math.round(rupees / 10) * 10 * 100;

interface SampleProduct {
  name: string;
  category: string;
  brand: string;
  /** Retail price in rupees. */
  price: number;
  variants?: string[];
  /** Different retail price per variant (rupees), same order as variants. */
  prices?: number[];
}

const CATEGORIES = [
  'Chargers',
  'Cables',
  'Cases & Covers',
  'Screen Protectors',
  'Earphones & Headphones',
  'Power Banks',
  'Holders & Stands',
  'Memory & Storage',
  'Smart Watches & Bands',
  'Speakers',
];

const BRANDS = [
  'Anker',
  'Apple',
  'Baseus',
  'Generic',
  'JBL',
  'Joyroom',
  'Kingston',
  'Remax',
  'Samsung',
  'SanDisk',
  'Ugreen',
  'Xiaomi',
];

const IPHONES = ['iPhone 13', 'iPhone 14', 'iPhone 15', 'iPhone 15 Pro', 'iPhone 16'];
const GALAXY = ['Galaxy A15', 'Galaxy A25', 'Galaxy A35', 'Galaxy A55', 'Galaxy S24'];
const REDMI = ['Redmi Note 13', 'Redmi Note 13 Pro', 'Redmi 13C'];

const PRODUCTS: SampleProduct[] = [
  // Chargers
  {
    name: 'Anker PowerPort III 20W USB-C Charger',
    category: 'Chargers',
    brand: 'Anker',
    price: 4500,
    variants: ['White', 'Black'],
  },
  { name: 'Anker Nano 30W Charger', category: 'Chargers', brand: 'Anker', price: 6900 },
  { name: 'Apple 20W USB-C Power Adapter', category: 'Chargers', brand: 'Apple', price: 8900 },
  {
    name: 'Samsung 25W Super Fast Charger',
    category: 'Chargers',
    brand: 'Samsung',
    price: 5900,
    variants: ['White', 'Black'],
  },
  {
    name: 'Samsung 45W Super Fast Charger 2.0',
    category: 'Chargers',
    brand: 'Samsung',
    price: 11500,
  },
  { name: 'Baseus 65W GaN 3-Port Charger', category: 'Chargers', brand: 'Baseus', price: 12500 },
  { name: 'Ugreen Nexode 30W Charger', category: 'Chargers', brand: 'Ugreen', price: 5400 },
  { name: 'Xiaomi 33W Fast Charger', category: 'Chargers', brand: 'Xiaomi', price: 3900 },
  { name: 'Remax Dual USB Car Charger', category: 'Chargers', brand: 'Remax', price: 1800 },
  { name: 'Baseus 30W Car Charger PD', category: 'Chargers', brand: 'Baseus', price: 3500 },
  { name: 'Generic 2A USB Wall Charger', category: 'Chargers', brand: 'Generic', price: 850 },
  // Cables
  {
    name: 'Ugreen USB-C to Lightning Cable',
    category: 'Cables',
    brand: 'Ugreen',
    price: 3200,
    variants: ['1m', '2m'],
    prices: [3200, 3900],
  },
  {
    name: 'Baseus 100W USB-C to USB-C Cable',
    category: 'Cables',
    brand: 'Baseus',
    price: 2400,
    variants: ['1m', '2m'],
    prices: [2400, 2900],
  },
  {
    name: 'Anker PowerLine III USB-C Cable',
    category: 'Cables',
    brand: 'Anker',
    price: 2900,
    variants: ['0.9m', '1.8m'],
    prices: [2900, 3500],
  },
  { name: 'Samsung USB-C to USB-C Cable 1m', category: 'Cables', brand: 'Samsung', price: 2200 },
  { name: 'Apple USB-C Woven Charge Cable 1m', category: 'Cables', brand: 'Apple', price: 5900 },
  { name: 'Joyroom 3-in-1 Charging Cable', category: 'Cables', brand: 'Joyroom', price: 1900 },
  { name: 'Generic Micro USB Cable 1m', category: 'Cables', brand: 'Generic', price: 450 },
  { name: 'Generic USB-C Cable 1m', category: 'Cables', brand: 'Generic', price: 550 },
  { name: 'Ugreen USB-C to 3.5mm Audio Adapter', category: 'Cables', brand: 'Ugreen', price: 1600 },
  // Cases
  {
    name: 'Silicone Case',
    category: 'Cases & Covers',
    brand: 'Generic',
    price: 1500,
    variants: IPHONES.flatMap((m) => [`${m} / Black`, `${m} / Navy`]),
  },
  {
    name: 'Clear TPU Case',
    category: 'Cases & Covers',
    brand: 'Generic',
    price: 900,
    variants: [...IPHONES, ...GALAXY],
  },
  {
    name: 'Shockproof Armor Case',
    category: 'Cases & Covers',
    brand: 'Generic',
    price: 1800,
    variants: [...GALAXY, ...REDMI],
  },
  {
    name: 'Leather Flip Cover',
    category: 'Cases & Covers',
    brand: 'Generic',
    price: 2200,
    variants: REDMI,
  },
  {
    name: 'Samsung Official Silicone Case',
    category: 'Cases & Covers',
    brand: 'Samsung',
    price: 6500,
    variants: ['Galaxy S24 / Black', 'Galaxy S24 / Lavender'],
  },
  {
    name: 'Baseus MagSafe Clear Case',
    category: 'Cases & Covers',
    brand: 'Baseus',
    price: 3400,
    variants: ['iPhone 15', 'iPhone 15 Pro', 'iPhone 16'],
  },
  // Screen protectors
  {
    name: 'Tempered Glass 9H',
    category: 'Screen Protectors',
    brand: 'Generic',
    price: 600,
    variants: [...IPHONES, ...GALAXY, ...REDMI],
  },
  {
    name: 'Privacy Tempered Glass',
    category: 'Screen Protectors',
    brand: 'Generic',
    price: 1200,
    variants: ['iPhone 15', 'iPhone 15 Pro', 'iPhone 16'],
  },
  {
    name: 'Camera Lens Protector',
    category: 'Screen Protectors',
    brand: 'Generic',
    price: 700,
    variants: ['iPhone 15', 'iPhone 15 Pro', 'iPhone 16'],
  },
  {
    name: 'Baseus Full Cover Glass (2 pack)',
    category: 'Screen Protectors',
    brand: 'Baseus',
    price: 2500,
    variants: ['iPhone 15', 'iPhone 16'],
  },
  // Earphones & headphones
  {
    name: 'JBL Tune 110 Wired Earphones',
    category: 'Earphones & Headphones',
    brand: 'JBL',
    price: 3200,
    variants: ['Black', 'White'],
  },
  {
    name: 'Samsung AKG Type-C Earphones',
    category: 'Earphones & Headphones',
    brand: 'Samsung',
    price: 3900,
  },
  {
    name: 'Apple EarPods (USB-C)',
    category: 'Earphones & Headphones',
    brand: 'Apple',
    price: 6500,
  },
  {
    name: 'Joyroom JR-T03 TWS Earbuds',
    category: 'Earphones & Headphones',
    brand: 'Joyroom',
    price: 4900,
    variants: ['Black', 'White'],
  },
  {
    name: 'Baseus Bowie E3 Earbuds',
    category: 'Earphones & Headphones',
    brand: 'Baseus',
    price: 6800,
    variants: ['Black', 'White'],
  },
  {
    name: 'Xiaomi Redmi Buds 6 Active',
    category: 'Earphones & Headphones',
    brand: 'Xiaomi',
    price: 5900,
    variants: ['Black', 'White', 'Blue'],
  },
  {
    name: 'JBL Tune 520BT Headphones',
    category: 'Earphones & Headphones',
    brand: 'JBL',
    price: 17500,
    variants: ['Black', 'Blue', 'White'],
  },
  {
    name: 'Anker Soundcore R50i Earbuds',
    category: 'Earphones & Headphones',
    brand: 'Anker',
    price: 7900,
    variants: ['Black', 'White'],
  },
  {
    name: 'Generic Wired Earphones 3.5mm',
    category: 'Earphones & Headphones',
    brand: 'Generic',
    price: 650,
  },
  // Power banks
  { name: 'Anker PowerCore 10000mAh', category: 'Power Banks', brand: 'Anker', price: 9900 },
  {
    name: 'Baseus Bipow 20000mAh 22.5W',
    category: 'Power Banks',
    brand: 'Baseus',
    price: 11500,
    variants: ['Black', 'White'],
  },
  {
    name: 'Xiaomi Redmi 10000mAh Power Bank',
    category: 'Power Banks',
    brand: 'Xiaomi',
    price: 6500,
    variants: ['Black', 'Blue'],
  },
  {
    name: 'Baseus MagSafe Power Bank 5000mAh',
    category: 'Power Banks',
    brand: 'Baseus',
    price: 8900,
    variants: ['White', 'Purple'],
  },
  { name: 'Remax 30000mAh Power Bank', category: 'Power Banks', brand: 'Remax', price: 14500 },
  // Holders & stands
  {
    name: 'Baseus Car Air Vent Phone Holder',
    category: 'Holders & Stands',
    brand: 'Baseus',
    price: 2900,
  },
  {
    name: 'Magnetic Car Phone Holder',
    category: 'Holders & Stands',
    brand: 'Generic',
    price: 1500,
  },
  {
    name: 'Phone Ring Holder',
    category: 'Holders & Stands',
    brand: 'Generic',
    price: 350,
    variants: ['Black', 'Silver', 'Gold', 'Rose Gold', 'Blue'],
  },
  {
    name: 'Tripod Stand with Bluetooth Remote',
    category: 'Holders & Stands',
    brand: 'Generic',
    price: 3500,
  },
  {
    name: 'Ugreen Adjustable Desk Phone Stand',
    category: 'Holders & Stands',
    brand: 'Ugreen',
    price: 2600,
    variants: ['Silver', 'Space Grey'],
  },
  { name: 'Bike Phone Mount', category: 'Holders & Stands', brand: 'Generic', price: 1900 },
  // Memory & storage
  {
    name: 'SanDisk Ultra microSD Card',
    category: 'Memory & Storage',
    brand: 'SanDisk',
    price: 2200,
    variants: ['32GB', '64GB', '128GB', '256GB'],
    prices: [2200, 3200, 5200, 9500],
  },
  {
    name: 'SanDisk Ultra Dual Drive USB-C',
    category: 'Memory & Storage',
    brand: 'SanDisk',
    price: 4200,
    variants: ['64GB', '128GB'],
    prices: [4200, 6400],
  },
  {
    name: 'Kingston DataTraveler Exodia',
    category: 'Memory & Storage',
    brand: 'Kingston',
    price: 1900,
    variants: ['32GB', '64GB'],
    prices: [1900, 2600],
  },
  { name: 'Ugreen USB-C OTG Adapter', category: 'Memory & Storage', brand: 'Ugreen', price: 1200 },
  { name: 'Generic Card Reader', category: 'Memory & Storage', brand: 'Generic', price: 600 },
  // Smart watches & bands
  {
    name: 'Xiaomi Smart Band 9',
    category: 'Smart Watches & Bands',
    brand: 'Xiaomi',
    price: 13500,
    variants: ['Midnight Black', 'Glacier Silver'],
  },
  {
    name: 'Silicone Watch Strap 44/45mm',
    category: 'Smart Watches & Bands',
    brand: 'Generic',
    price: 1200,
    variants: ['Black', 'White', 'Navy', 'Red', 'Olive'],
  },
  {
    name: 'Smart Band Charging Cable',
    category: 'Smart Watches & Bands',
    brand: 'Generic',
    price: 800,
  },
  // Speakers
  {
    name: 'JBL Go 4 Portable Speaker',
    category: 'Speakers',
    brand: 'JBL',
    price: 15900,
    variants: ['Black', 'Blue', 'Red'],
  },
  {
    name: 'JBL Flip 6 Speaker',
    category: 'Speakers',
    brand: 'JBL',
    price: 38500,
    variants: ['Black', 'Blue'],
  },
  { name: 'Xiaomi Mi Portable Speaker 16W', category: 'Speakers', brand: 'Xiaomi', price: 11900 },
  { name: 'Remax Mini Bluetooth Speaker', category: 'Speakers', brand: 'Remax', price: 3900 },
];

const env = (name: string, fallback: string) => process.env[name] || fallback;

async function seedBasics() {
  await prisma.user.create({
    data: {
      username: 'superadmin',
      fullName: 'Super Admin',
      role: 'SUPER_ADMIN',
      passwordHash: await hashSecret(env('SEED_SUPERADMIN_PASSWORD', 'super123')),
      pinHash: await hashSecret(env('SEED_SUPERADMIN_PIN', '9999')),
    },
  });
  const admin = await prisma.user.create({
    data: {
      username: 'admin',
      fullName: 'Shop Owner',
      role: 'ADMIN',
      passwordHash: await hashSecret(env('SEED_ADMIN_PASSWORD', 'admin123')),
      pinHash: await hashSecret(env('SEED_ADMIN_PIN', '1234')),
    },
  });
  await prisma.taxRate.createMany({
    data: [
      { name: 'No tax', rateBp: 0, isDefault: true },
      { name: 'VAT 18%', rateBp: 1800, isDefault: false },
    ],
  });
  return admin;
}

/** Typical warranty in a Sri Lankan accessories shop, by category (days). */
const WARRANTY_BY_CATEGORY: Record<string, number> = {
  Chargers: 365,
  'Power Banks': 365,
  'Earphones & Headphones': 182,
  Speakers: 365,
  'Smart Watches & Bands': 365,
  Cables: 91,
  'Memory & Storage': 730,
};

async function seedSample(adminId: string) {
  const categories = new Map<string, string>();
  for (const name of CATEGORIES) {
    categories.set(name, (await prisma.category.create({ data: { name } })).id);
  }
  const brands = new Map<string, string>();
  for (const name of BRANDS) {
    brands.set(name, (await prisma.brand.create({ data: { name } })).id);
  }

  let sku = 0;
  let barcode = 0;
  let variantCount = 0;
  for (const p of PRODUCTS) {
    const product = await prisma.product.create({
      data: {
        name: p.name,
        categoryId: categories.get(p.category)!,
        brandId: brands.get(p.brand)!,
        warrantyDays: WARRANTY_BY_CATEGORY[p.category] ?? 0,
      },
    });
    const names = p.variants ?? [''];
    for (const [i, variantName] of names.entries()) {
      const retail = rs(p.prices?.[i] ?? p.price);
      const cost = rs((retail / 100) * 0.62);
      const wholesale = rs((retail / 100) * 0.85);
      const stock = rand() < 0.08 ? 0 : pick(1, 40);
      const variant = await prisma.productVariant.create({
        data: {
          productId: product.id,
          sku: `P${String(++sku).padStart(6, '0')}`,
          name: variantName,
          costPrice: cost,
          retailPrice: retail,
          wholesalePrice: wholesale,
          stockQty: stock,
          reorderLevel: pick(2, 5),
          barcodes: { create: { code: makeInternalEan13(++barcode) } },
        },
      });
      if (stock > 0) {
        await prisma.stockMovement.create({
          data: {
            variantId: variant.id,
            type: 'OPENING',
            qtyChange: stock,
            qtyAfter: stock,
            unitCost: cost,
            refType: 'Product',
            refId: product.id,
            note: 'Opening stock (sample data)',
            userId: adminId,
          },
        });
      }
      variantCount++;
    }
  }
  await prisma.documentCounter.createMany({
    data: [
      { key: 'SKU', value: sku },
      { key: 'BARCODE', value: barcode },
    ],
  });
  console.log(`Sample data: ${PRODUCTS.length} products, ${variantCount} variants`);
}

async function main() {
  if ((await prisma.user.count()) > 0) {
    console.log('Database already has users — seed skipped.');
    return;
  }
  const admin = await seedBasics();
  if (!minimal) await seedSample(admin.id);
  console.log('Seed done. Accounts: superadmin (Super Admin) and admin (Shop Owner).');
  console.log('Add cashiers from the Users page.');
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
