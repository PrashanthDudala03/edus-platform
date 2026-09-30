// Isolated legacy QA schools are created with SQL by the existing tests. Give their
// roles the same persisted templates and initial grants as platform onboarding.
export const seedIamSql=(school:string)=>`
INSERT INTO auth_db.school_access(school_id,allowed) VALUES('${school}',ARRAY(SELECT key FROM auth_db.permissions WHERE enabled AND delegatable)) ON CONFLICT DO NOTHING;
INSERT INTO auth_db.role_permissions(id,role_id,permission_key)
SELECT gen_random_uuid(),r.id,p FROM auth_db.roles r JOIN auth_db.role_templates t ON t.name=r.name,unnest(t.defaults) p
WHERE r.school_id='${school}' ON CONFLICT DO NOTHING;
UPDATE auth_db.roles r SET template_id=t.id,assignable=t.assignable FROM auth_db.role_templates t WHERE r.school_id='${school}' AND r.name=t.name;
`
export const clearIamSql=(school:string)=>`DELETE FROM auth_db.signup_requests WHERE school_id='${school}';DELETE FROM auth_db.school_access WHERE school_id='${school}';DELETE FROM auth_db.iam_audit WHERE school_id='${school}';`
