# API and SQL transcript (unpaid walkthrough)

Stack: container `devdigest-hw2f-d8b288cf`, database `devdigest_hw2f_d8b288cf`, API `http://127.0.0.1:3251`. Commands as run; output verbatim.

## Row 8: skills CRUD reads and writes PostgreSQL

Create through the API, then find the row in the database:
```
$ curl -s http://127.0.0.1:3251/skills | python3 -c 'import json,sys; print([s["name"] for s in json.load(sys.stdin) if s["id"]=="fef0880a-0e36-47f8-bc70-7610bc448b7f"])'
['row8-crud']
```
```
$ docker exec devdigest-hw2f-d8b288cf psql -U devdigest -d devdigest_hw2f_d8b288cf -At -c "select id, name, version from skills where id='fef0880a-0e36-47f8-bc70-7610bc448b7f'"
fef0880a-0e36-47f8-bc70-7610bc448b7f|row8-crud|1
```
Delete the row directly in the database, then the API no longer returns it:
```
$ docker exec devdigest-hw2f-d8b288cf psql -U devdigest -d devdigest_hw2f_d8b288cf -At -c "delete from skills where id='fef0880a-0e36-47f8-bc70-7610bc448b7f' returning name"
row8-crud
DELETE 1
```
```
$ curl -s http://127.0.0.1:3251/skills | python3 -c 'import json,sys; print("present" if any(s["id"]=="fef0880a-0e36-47f8-bc70-7610bc448b7f" for s in json.load(sys.stdin)) else "absent from GET /skills")'
absent from GET /skills
```

### Independent POST-to-SQL reproduction, 2026-10-27

A separate identity-only disposable stack (`devdigest-hw2f-7f47676c`,
database `devdigest_hw2f_7f47676c`, API `127.0.0.1:3271`) had no
spending capability. A Python `urllib.request` script sent
`POST /skills` with
`{"name":"row8-crud-20261027","description":"Disposable acceptance evidence","type":"rubric","body":"Check the caller-visible behavior."}`.
It then called `GET /skills`, used `docker exec ... psql` to select the
created row, deleted that row directly in PostgreSQL, and called
`GET /skills` again. The script asserted every relationship and printed
this actual result:

```json
{"post_http":201,"post_id":"2a364dc6-c304-4f3a-8ebd-7aedd15ca219","post_name":"row8-crud-20261027","get_present":true,"sql_select":"2a364dc6-c304-4f3a-8ebd-7aedd15ca219|row8-crud-20261027|1","sql_delete":"row8-crud-20261027\nDELETE 1","get_absent":true}
```

The temporary stack was torn down after capture. The original evidence
stack and the isolated extraction stack remained healthy; no model call
was made.

## Rows 27 and 29: versions and restore (skill `walkthrough-skill`)

After Restore on v1 in the Versioning tab, v4 holds v1's body and the history is kept:
```
$ docker exec devdigest-hw2f-d8b288cf psql -U devdigest -d devdigest_hw2f_d8b288cf -At -c "select version, md5(body) from skill_versions where skill_id='760a6971-6cb2-43f2-ae4a-18c152e11f12' order by version"
1|4f99143cb7e9cb61990b1d516501e2a3
2|512f3354b2932364f72f6014fb80fcdd
3|ca8ca7ca24591e1e1dbcf4f06f685638
4|4f99143cb7e9cb61990b1d516501e2a3
```
```
$ docker exec devdigest-hw2f-d8b288cf psql -U devdigest -d devdigest_hw2f_d8b288cf -At -c "select version, md5(body) from skills where id='760a6971-6cb2-43f2-ae4a-18c152e11f12'"
4|4f99143cb7e9cb61990b1d516501e2a3
```

## Row 22: agent_count on GET /skills

```
$ curl -s http://127.0.0.1:3251/skills | python3 -c 'import json,sys; [print(s["name"], "v"+str(s["version"]), "agent_count="+str(s["agent_count"]), "used_by_count="+str(s["used_by_count"])) for s in json.load(sys.stdin)]'
Assertion Quality v1 agent_count=1 used_by_count=1
Behavioral Coverage v1 agent_count=1 used_by_count=1
breaking-change v1 agent_count=1 used_by_count=1
Edge Cases and Error Paths v1 agent_count=1 used_by_count=1
response-schema v1 agent_count=1 used_by_count=1
semver-discipline v1 agent_count=1 used_by_count=1
Test Isolation and Determinism v1 agent_count=1 used_by_count=1
walkthrough-skill v4 agent_count=0 used_by_count=0
```

## Rows 15 and 16: imported skill linked to the API Contract Reviewer

deprecation-policy.md (1,754 bytes) was imported through Skills → Add skill → Import skill (preview, then Import), enabled from its card, and linked in the agent's Skills tab (4 / 4 attached).
```
$ psql -c "select s.name, s.source, s.enabled, a.name agent, l.\"order\", l.enabled link_enabled from skills s join agent_skills l on l.skill_id = s.id join agents a on a.id = l.agent_id where a.name = 'API Contract Reviewer' order by l.\"order\""
        name        |    source     | enabled |         agent         | order | link_enabled 
--------------------+---------------+---------+-----------------------+-------+--------------
 breaking-change    | manual        | t       | API Contract Reviewer |     0 | t
 response-schema    | manual        | t       | API Contract Reviewer |     1 | t
 semver-discipline  | manual        | t       | API Contract Reviewer |     2 | t
 deprecation-policy | imported_file | t       | API Contract Reviewer |     3 | t
(4 rows)

```
```
$ curl -s http://127.0.0.1:3251/agents  # skill_count per agent
General Reviewer skill_count=0
Security Reviewer skill_count=0
Performance Reviewer skill_count=0
Test Quality Reviewer skill_count=4
API Contract Reviewer skill_count=4
```

## Rows 13, 31, 37: per-agent switch and drag eligibility

semver-discipline was switched off for the API Contract Reviewer with its per-agent switch in the Skills tab. The link stays; only that agent's switch changes; the skill itself stays enabled:
```
        name        | skill_enabled | link_enabled | order 
--------------------+---------------+--------------+-------
 breaking-change    | t             | t            |     0
 response-schema    | t             | t            |     1
 semver-discipline  | t             | f            |     2
 deprecation-policy | t             | t            |     3
(4 rows)

```
Drag eligibility read from the rendered rows (`draggable` attribute): only linked rows that are on for the agent are draggable; the switched-off link and every unlinked skill are not:
```
breaking-change linked=true onForAgent=true draggable=true
response-schema linked=true onForAgent=true draggable=true
semver-discipline linked=true onForAgent=false draggable=false (badge: off for this agent)
deprecation-policy linked=true onForAgent=true draggable=true
Assertion Quality linked=false draggable=false
Behavioral Coverage linked=false draggable=false
Edge Cases and Error Paths linked=false draggable=false
Test Isolation and Determinism linked=false draggable=false
walkthrough-skill linked=false draggable=false
```
A synthetic pointer drag from the browser automation (left-click drag on the handle) did **not** start a native HTML5 drag: the persisted order stayed breaking-change, response-schema, semver-discipline, deprecation-policy. The physical drag is done by a person (row 13/14/31 open issue).

## Rows 33 and 34: agent delete removes it from the database

Throwaway agent `10f02b75-6c44-473b-b9cc-ba78688b1990` (created through the API). In the Agents page its Delete button opened the confirmation; Cancel and X kept it; Delete removed it:
```
$ psql -At -c "select count(*) from agents where id='10f02b75-6c44-473b-b9cc-ba78688b1990'"   # after Cancel and X
1
$ psql -At -c "select count(*) from agents where id='10f02b75-6c44-473b-b9cc-ba78688b1990'"   # after Delete
0
```

## Rows 23 and 24: skill delete from its card

`walkthrough-skill` (`760a6971-6cb2-43f2-ae4a-18c152e11f12`): the card's Delete opened the confirmation ("No agent uses this skill."); Cancel and X kept it; Delete removed it:
```
$ psql -At -c "select count(*) from skills where id='760a6971-6cb2-43f2-ae4a-18c152e11f12'"   # after Cancel and X
1
$ psql -At -c "select count(*) from skills where id='760a6971-6cb2-43f2-ae4a-18c152e11f12'"   # after Delete
0
```

## Rows 41, 42, 45 to 52: conventions workflow (labelled synthetic candidates)

The four candidates on this stack are seeded synthetic fixtures, each labelled "Synthetic fixture — not a model extraction" (a live extraction is a paid call, row 38). In the Conventions page: one candidate rejected, one edited inline then accepted, one accepted, the page reloaded, then Create skill → linked to General Reviewer → Create.
```
$ psql -c "select category, status, rule from conventions order by category"
 category |  status  |                                     rule                                     
----------+----------+------------------------------------------------------------------------------
 api      | accepted | Answer a missing resource with HTTP 404 and the body { error: 'not_found' }
 errors   | rejected | Throw an Error whose message names the rejected input
 naming   | pending  | Suffix integer money amounts with Cents
 testing  | accepted | Keep unit tests next to the module as <name>.test.ts (edited in walkthrough)
(4 rows)

$ psql -c "select s.name, s.type, s.enabled, s.version, a.name agent from skills s left join agent_skills l on l.skill_id = s.id left join agents a on a.id = l.agent_id where s.name = 'repo-conventions'"
       name       |    type    | enabled | version |      agent       
------------------+------------+---------+---------+------------------
 repo-conventions | convention | t       |       1 | General Reviewer
(1 row)

$ psql -At -c "select position('Throw an Error' in body) > 0 as has_rejected_rule, position('edited in walkthrough' in body) > 0 as has_edited_rule, position('HTTP 404' in body) > 0 as has_accepted_rule from skills where name = 'repo-conventions'"
f|t|t
```
