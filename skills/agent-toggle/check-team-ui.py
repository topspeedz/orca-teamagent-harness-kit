"""Run with Python Playwright + Chromium and the matching kit checkout (optional --kit PATH)."""
import argparse
import json
import os
import shutil
import subprocess
import tempfile
from contextlib import contextmanager
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


skill = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--kit", type=Path, default=skill.parents[1])
kit = parser.parse_args().kit.resolve()
if not (kit / "skills/setup/scripts/setup.mjs").is_file():
    parser.error("설치 키트 저장소를 --kit PATH로 지정하세요.")


def write(root, rel, text):
    file = root / rel
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(text, encoding="utf-8")
    return file


def install(root):
    root.mkdir()
    program = """
      import { planInstall, applyInstall } from './skills/setup/scripts/setup.mjs';
      const answers = {planner:{effort:'high'}, approvalPrefixes:[], codex:true};
      const plan = planInstall('template', 'template-codex', process.argv[1], answers, {globalDiagramSkills:{}});
      const {conflicts} = applyInstall(plan);
      if (conflicts.length) throw Error(conflicts.join(','));
    """
    subprocess.run(["node", "--input-type=module", "-e", program, str(root)], cwd=kit, check=True)


@contextmanager
def server(project, home):
    env = dict(os.environ, USERPROFILE=str(home), HOME=str(home),
               CLAUDE_CONFIG_DIR=str(home / ".claude"), CODEX_HOME=str(home / ".codex"))
    proc = subprocess.Popen(["node", str(skill / "server.mjs")], cwd=project, env=env,
                            stdout=subprocess.PIPE, encoding="utf-8")
    try:
        url = proc.stdout.readline().strip().rstrip("/")
        assert url.startswith("http://127.0.0.1:"), url
        yield url
    finally:
        proc.terminate()
        proc.wait(timeout=10)
        proc.stdout.close()


def new_role(project, name, responsibilities="", collaborations=""):
    text = f"""---
name: {name}
description: {name} 설명
---
# {name}
## 핵심 역할
- {name} 책임
### 읽는 입력
- 승인 문서
### 작업 산출물
- Task 리포트
## 문서 책임
| 문서 | 범위 | 책임 |
| --- | --- | --- |
{responsibilities}
## 직접 협업
| 상대 | 협의 주제 | 목적 |
| --- | --- | --- |
{collaborations}
## 완료 기준
- 검사 결과 첨부
"""
    return write(project, f".claude/agents/{name}.md", text)


def chart_checks(page, url, project):
    request = page.request
    response = request.get(url + "/team.json")
    initial_tag = response.headers["etag"]
    assert request.get(url + "/team.json", headers={"If-None-Match": initial_tag}).status == 304
    data = response.json()
    assert len(data["common"]) == 13
    assert all(d["title"] for d in data["common"])
    page.goto(url + "/team-structure.html", wait_until="domcontentloaded")
    dialog = page.get_by_role("dialog")
    team = page.locator(".group").filter(has=page.get_by_role("heading", name="DEV", exact=True))
    lead = team.locator(".lead")
    expect(lead).to_contain_text("OFF")
    expect(team).to_contain_text("팀 배정 대기")
    expect(team.locator(".node").get_by_text("api-writer", exact=True)).to_be_visible()
    expect(page.locator("svg [data-team='dev']")).to_have_count(0)
    for name in ["doc-steward", "harness-engineer"]:
        expect(page.locator(f"svg [data-role='{name}']")).to_have_attribute("data-from", "코디네이터")
    for name in ["product-manager", "planner"]:
        expect(page.locator(f"svg [data-role='{name}']")).to_have_attribute("data-from", "창구")
    expect(page.locator(".independent-roles").filter(has_text="팀장 없음").locator(".lead")).to_have_count(0)

    common = page.get_by_role("button", name="docs/ · 공통 기준 문서", exact=True)
    common.click()
    expect(dialog.locator(".document-entry")).to_have_count(13)
    for doc in data["common"]:
        entry = dialog.locator(".document-entry").filter(has=page.get_by_role("heading", name=doc["title"], exact=True))
        if doc["path"].endswith("11-operations/draft.md"):
            expect(entry).to_contain_text("해당 없음")
        else:
            entry.get_by_role("button", name=doc["path"], exact=True).click()
            expect(dialog.locator("pre")).to_contain_text("검증 원문 " + doc["path"])
            dialog.get_by_role("button", name="← 이전").click()
    doc = dialog.locator(".document-entry").filter(has_text="contracts/api.md")
    expect(doc).to_contain_text("응답")
    expect(doc).to_contain_text("오류")
    doc.get_by_role("button", name="api-writer", exact=True).click()
    expect(dialog.get_by_role("heading", name="api-writer", exact=True)).to_be_visible()
    for title in ["핵심 책임", "읽는 입력", "작업 산출물", "작성할 라이브 문서 · 절", "주요 검토자", "직접 협업 상대", "완료 기준"]:
        expect(dialog.get_by_role("heading", name=title, exact=True)).to_be_visible()
    dialog.get_by_role("button", name="ui-writer", exact=True).click()
    expect(dialog.get_by_role("heading", name="ui-writer", exact=True)).to_be_visible()
    dialog.get_by_role("button", name="← 이전").click()
    dialog.get_by_role("button", name="Codex 원문 보기 · OFF").click()
    expect(dialog.locator("pre")).to_contain_text("Codex 전용 원문")
    page.keyboard.press("Escape")

    page.get_by_role("tab", name="문서 소유권").click()
    expect(page.get_by_role("columnheader")).to_have_text(["문서 · 범위", "정본 작성자", "주요 검토자"])
    row = page.get_by_role("row").filter(has_text="contracts/api.md").filter(has_text="응답")
    expect(row.get_by_role("cell").nth(1)).to_have_text("api-writer")
    expect(row.get_by_role("cell").first).to_contain_text("확인 harness-engineer")
    reviewers = row.get_by_role("cell").nth(2).get_by_role("button")
    assert set(reviewers.all_text_contents()) == {"qa-inspector", "doc-steward"}
    colors = {}
    for button in row.get_by_role("cell").nth(1).get_by_role("button").all() + reviewers.all():
        name = button.text_content()
        colors[name] = button.evaluate("b => b.style.getPropertyValue('--tone')")
        button.click()
        expect(dialog.get_by_role("heading", name=name, exact=True)).to_be_visible()
        assert dialog.evaluate("d => d.style.getPropertyValue('--tone')") == colors[name]
        page.keyboard.press("Escape")
    assert len(set(colors.values())) == 3
    page.get_by_role("tab", name="직접 협업").click()
    pair = page.locator(".collaboration-row").filter(has_text="응답 형식")
    expect(pair).to_have_count(1)
    expect(pair).to_contain_text("오류 필드를 확인")
    expect(pair).to_contain_text("↔")
    assert pair.get_by_role("button", name="api-writer").evaluate("b => b.style.getPropertyValue('--tone')") == colors["api-writer"]
    pair.get_by_role("button", name="ui-writer").click()
    expect(dialog.get_by_role("heading", name="ui-writer")).to_be_visible()
    page.keyboard.press("Escape")

    manager = page.context.new_page()
    manager.goto(url, wait_until="domcontentloaded")
    expect(manager.locator("#meta")).to_contain_text(str(project))

    def toggle(name, state):
        manager.locator(f'article[data-name="{name}"][data-engine="Claude Code"] button[data-v="{state}"]').click()

    toggle("api-writer", "off")
    expect(pair).to_have_count(0)
    page.get_by_role("tab", name="문서 소유권").click()
    expect(row.get_by_role("cell").nth(1)).to_have_text("api-writer")
    toggle("api-writer", "on")
    toggle("dev-lead", "on")
    page.get_by_role("tab", name="팀 구조도").click()
    expect(lead).not_to_contain_text("OFF")
    expect(team).not_to_contain_text("팀 배정 대기")
    expect(page.locator("svg [data-team='dev']")).to_have_attribute("data-from", "코디네이터")
    team.get_by_text("업무 관계 보기").click()
    expect(team).to_contain_text("복잡한 내부 분해")
    expect(team.locator(".team-flows").get_by_role("button", name="planner")).to_be_visible()
    expect(page.locator(".independent-roles").filter(has_text="팀장 없음").get_by_text("planner", exact=True)).to_be_visible()
    manager.close()

    common.click()
    dialog.get_by_role("button", name="contracts/api.md", exact=True).click()
    write(project, "contracts/api.md", "변경한 실제 본문")
    expect(dialog.locator("pre")).to_have_text("변경한 실제 본문")
    page.keyboard.press("Escape")
    index = project / "docs/DOCUMENTATION_INDEX.md"
    write(project, "contracts/api-next.md", "색인이 바뀐 정본")
    index.write_text(index.read_text(encoding="utf-8").replace("../contracts/api.md", "../contracts/api-next.md"), encoding="utf-8")
    common.click()
    dialog.get_by_role("button", name="contracts/api-next.md", exact=True).click()
    expect(dialog.locator("pre")).to_have_text("색인이 바뀐 정본")
    page.keyboard.press("Escape")
    new_role(project, "extra-lead")
    new_role(project, "extra-member")
    with (project / "docs/harness/team-org.md").open("a", encoding="utf-8") as f:
        f.write("\n| `extra` | `extra-lead` | `extra-member` | | | 실행팀 |\n")
    expect(page.locator(".group").filter(has_text="extra-lead")).to_contain_text("extra-member")
    assert request.get(url + "/team.json", headers={"If-None-Match": initial_tag}).status == 200
    page.set_viewport_size({"width": 390, "height": 844})
    page.get_by_role("tab", name="직접 협업").click()
    pair.get_by_role("button", name="api-writer").click()
    expect(dialog.get_by_role("heading", name="api-writer")).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.keyboard.press("Escape")
    page.get_by_role("tab", name="문서 소유권").click()
    page.get_by_role("row").filter(has_text="contracts/api-next.md").filter(has_text="응답").get_by_role("button", name="qa-inspector").click()
    expect(dialog.get_by_role("heading", name="qa-inspector", exact=True)).to_be_visible()
    page.keyboard.press("Escape")
    page.get_by_role("tab", name="팀 구조도").click()
    common.click()
    expect(dialog.locator(".document-entry")).to_have_count(13)
    page.keyboard.press("Escape")


def survey_checks(page, url, project, other):
    path = "docs/harness/model-selection.md"
    file = project / path
    unrelated = (other / path).read_bytes()
    with file.open("ab") as notes:
        notes.write("\n사용자 메모 · 다음 계획 전 확인\n".encode())
    original = file.read_bytes()
    open_button = page.get_by_role("button", name="모델 선택 표", exact=True)
    with page.context.expect_page() as popup:
        open_button.click()
    survey = popup.value
    row = survey.get_by_role("row").filter(has_text="product-manager").filter(has_text="계획 대조")
    model = row.locator("select[id^='model-']")
    expect(model).to_have_value("opus")
    model.select_option("sonnet")
    with survey.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/model-selection")) as pending:
        survey.get_by_role("button", name="저장", exact=True).click()
    result = pending.value
    assert result.ok, result.text()
    assert len(result.request.post_data_json["choices"]) == 1
    expect(survey.locator("#status")).to_have_text("프로젝트 모델 표에 저장했습니다.")
    original_row = next(line for line in original.splitlines() if "`product-manager` | 계획 대조 |".encode() in line)
    assert file.read_bytes() == original.replace(original_row, original_row.replace(b"| opus |", b"| sonnet |"), 1)
    assert file.read_bytes() != original
    survey.close()
    page.locator(".independent-roles .node").filter(has=page.get_by_text("product-manager", exact=True)).click()
    expect(page.get_by_role("dialog")).to_contain_text("계획 대조 · claude · sonnet / medium")
    page.keyboard.press("Escape")
    with page.context.expect_page() as popup:
        open_button.click()
    survey = popup.value
    row = survey.get_by_role("row").filter(has_text="product-manager").filter(has_text="계획 대조")
    expect(row.locator("select[id^='model-']")).to_have_value("sonnet")
    state = survey.evaluate("DATA.localSave")
    headers = {"Content-Type":"application/json", "Origin":url, "x-agent-toggle":state["token"]}
    endpoint = url + "/model-selection"
    assert page.request.get(endpoint, headers={"Origin":"http://other.invalid"}).status == 403
    snapshot = file.read_bytes()
    choice = {"agent":"product-manager", "unit":"계획 대조", "runtime":"claude", "model":"opus", "effort":"medium"}
    for change in [{"model":"unknown"}, {"unit":"누락된 구형 행"}, {"model":"haiku","effort":"high"}]:
        assert page.request.post(endpoint, headers=headers, data={"choices":[dict(choice, **change)], "revision":state["revision"]}).status == 400
    for change in [{"Origin":"http://other.invalid"}, {"x-agent-toggle":"wrong"}, {"Host":"other.invalid"}]:
        assert page.request.post(endpoint, headers={**headers, **change}, data={"choices":[choice], "revision":state["revision"]}).status == 403
    assert file.read_bytes() == snapshot
    lock = file.with_name(file.name + ".agent-toggle-save")
    lock.touch()
    row.locator("select[id^='model-']").select_option("opus")
    survey.get_by_role("button", name="저장", exact=True).click()
    expect(survey.locator("#status")).to_contain_text("저장하지 못했습니다")
    assert file.read_bytes() == snapshot
    lock.unlink()
    file.write_bytes(snapshot + "\n사용자 외부 메모\n".encode())
    survey.get_by_role("button", name="저장", exact=True).click()
    expect(survey.locator("#status")).to_contain_text("다른 곳에서 변경")
    assert file.read_bytes() == snapshot + "\n사용자 외부 메모\n".encode()
    assert (other / path).read_bytes() == unrelated
    survey.close()
    for asset in [".claude/scripts/model-table.mjs", ".claude/scripts/model-selection.mjs", "docs/harness/templates/model-survey.html"]:
        target = project / asset
        before = target.read_bytes()
        target.write_bytes(before + b"\n ")
        assert page.request.get(endpoint).status == 503
        target.write_bytes(before)


def fixtures(project):
    index = project / "docs/DOCUMENTATION_INDEX.md"
    index_text = index.read_text(encoding="utf-8")
    index_text = index_text.replace("OpenAPI | 없음", "OpenAPI | [계약](../contracts/api.md)")
    index_text = index_text.replace("| `docs/11-operations/draft.md` | 전체 | 미배정 |",
                                    "| `docs/11-operations/draft.md` | 전체 | 해당 없음 |")
    index_text = index_text.replace("| `docs/05-api/draft.md` | 전체 | 미배정 |\n", "")
    index.write_text(index_text, encoding="utf-8")
    drafts = json.loads((project / "docs/harness/templates/document-drafts.json").read_text(encoding="utf-8"))
    for draft in drafts:
        if draft.endswith("11-operations/draft.md"):
            (project / draft).unlink()
        else:
            write(project, draft, "검증 원문 " + draft)
    write(project, "contracts/api.md", "검증 원문 contracts/api.md")
    scope = "| `docs/05-api/draft.md` | 응답 | "
    new_role(project, "dev-lead").rename(project / ".claude/agents/dev-lead.md.agent-toggle-off")
    new_role(project, "api-writer", scope + "작성 |", "| `ui-writer` | 응답 형식 | 오류 필드를 확인 |")
    new_role(project, "ui-writer", "| `docs/05-api/draft.md` | 오류 | 작성 |")
    for name, responsibility in [("qa-inspector","검토"), ("doc-steward","검토"), ("harness-engineer","확인")]:
        role = project / f".claude/agents/{name}.md"
        body = role.read_text(encoding="utf-8")
        key = "## 문서 책임\n\n| 문서 | 범위 | 책임 |\n| --- | --- | --- |"
        assert key in body
        role.write_text(body.replace(key, key + "\n" + scope + responsibility + " |"), encoding="utf-8")
    write(project, ".codex/agents/api-writer.toml.agent-toggle-off", 'description = "Codex 전용 원문"')
    with (project / "docs/harness/team-org.md").open("a", encoding="utf-8") as f:
        f.write("\n| `dev` | `dev-lead` | `api-writer`, `ui-writer` | | | 실행팀 |\n")


def legacy_checks(page, url):
    page.goto(url + "/team-structure.html")
    expect(page.locator(".group")).to_contain_text("old-member")
    page.get_by_role("tab", name="문서 소유권").click()
    expect(page.locator("tbody tr")).to_have_count(1)
    expect(page.locator("tbody tr")).to_contain_text("spec.md")
    expect(page.locator("tbody tr")).not_to_contain_text("input.md")
    page.get_by_role("tab", name="직접 협업").click()
    expect(page.locator(".collaboration-row")).to_have_count(0)


with tempfile.TemporaryDirectory(prefix="agent-toggle-ui-") as tmp, sync_playwright() as playwright:
    root = Path(tmp)
    home = root / "home"
    cached = home / ".claude/plugins/cache/orca-teamagent/orca-teamagent-harness-kit/test"
    for asset in ["skills/setup/scripts/model-table.mjs", "template/.claude/scripts/model-selection.mjs",
                  "skills/setup/assets/model-survey.html"]:
        target = cached / asset
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(kit / asset, target)
    project, other = root / "A", root / "B"
    install(project)
    install(other)
    fixtures(project)
    table_b = other / "docs/harness/model-selection.md"
    table_b.write_bytes(table_b.read_bytes() + b"\nProject B\n")
    browser = playwright.chromium.launch()
    context = browser.new_context(viewport={"width": 1500, "height": 1000})
    context.set_default_timeout(7000)
    context.route("https://fonts.googleapis.com/**", lambda route: route.abort())
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    with server(project, home) as url:
        chart_checks(page, url, project)
        survey_checks(page, url, project, other)
    old = root / "legacy"
    write(old, ".claude/agents/old-lead.md", "## 책임\n- 정본 소유: `spec.md`\n")
    write(old, ".claude/agents/old-member.md", "## 입력\n- `input.md`\n")
    write(old, "docs/harness/team-org.md", "| `legacy` | `old-lead` | `old-member` | | |\n")
    with server(old, home) as url:
        legacy_checks(page, url)
        data = page.request.get(url + "/team.json").json()
        page.route("**/team.json", lambda route: route.fulfill(json=data))
        legacy_checks(page, url)
    assert not errors, errors
    browser.close()
print("Passed: installed A/B, legacy HTTP and browser fixture, desktop and mobile")
