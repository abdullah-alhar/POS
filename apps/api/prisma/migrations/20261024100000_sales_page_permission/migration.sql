-- The Sales page (past bills) has its own permission now, so an admin can hide it from a user.
-- Everyone who could make sales keeps seeing it.
UPDATE "User"
SET "permissions" = array_append("permissions", 'sales.view')
WHERE 'sales.create' = ANY("permissions")
  AND NOT ('sales.view' = ANY("permissions"));
