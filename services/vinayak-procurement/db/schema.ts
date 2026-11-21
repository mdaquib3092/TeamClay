import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const workspaces = sqliteTable('workspaces', {
  ownerId: text('owner_id').primaryKey(),
  revision: integer('revision').notNull().default(0),
  state: text('state').notNull(),
  updatedAt: text('updated_at').notNull(),
});
export const attachments = sqliteTable('attachments', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull(),
  name: text('name').notNull(), objectKey: text('object_key').notNull(),
  mediaType: text('media_type').notNull(), createdAt: text('created_at').notNull(),
});
