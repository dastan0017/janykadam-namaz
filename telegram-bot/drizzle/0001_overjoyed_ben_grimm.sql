ALTER TABLE "geonames" ADD COLUMN "name_norm" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "geonames_name_norm_idx" ON "geonames" USING btree ("name_norm");