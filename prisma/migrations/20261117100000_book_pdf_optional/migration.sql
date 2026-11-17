-- The book PDF is optional: the Admin may add it after the book is created.
ALTER TABLE "books" ALTER COLUMN "pdf_id" DROP NOT NULL;
