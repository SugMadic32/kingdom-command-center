import { z } from 'zod';
import { tx } from './db.js';
import { bad } from './http.js';

export const inventorySchema = z.record(z.string().max(40), z.number().int().min(0).max(1e15));
export const buildingsSchema = z.array(z.object({
  building_id: z.number().int().positive(), level: z.number().int().min(0).max(1000), notes: z.string().max(300).optional(),
})).max(500);

/** Saves a member's inventory (resources + speedups). `by` is the member or the leader helping them. */
export async function saveInventory(userId: number, b: z.infer<typeof inventorySchema>, by: number) {
  await tx(async (c) => {
    for (const [key, amount] of Object.entries(b)) {
      await c.query(
        `INSERT INTO member_inventory (user_id, resource_key, amount, updated_by) VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id, resource_key) DO UPDATE SET amount = EXCLUDED.amount, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [userId, key, amount, by]);
    }
  });
}

export async function saveBuildings(userId: number, b: z.infer<typeof buildingsSchema>, by: number) {
  await tx(async (c) => {
    for (const r of b) {
      const max = (await c.query('SELECT max_level FROM game_buildings WHERE id = $1', [r.building_id])).rows[0]?.max_level;
      if (max == null) throw bad(`Building ${r.building_id} does not exist.`);
      if (r.level > max) throw bad(`Level ${r.level} is above the maximum of ${max}.`);
      await c.query(
        `INSERT INTO member_buildings (user_id, building_id, level, notes, updated_by) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id, building_id) DO UPDATE SET level = EXCLUDED.level, notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [userId, r.building_id, r.level, r.notes ?? '', by]);
    }
  });
}
