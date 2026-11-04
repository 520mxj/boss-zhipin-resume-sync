# BOSS Zhipin DOM map

This map records selectors observed on the candidate online-resume page on 2026-11-05. BOSS can change its DOM at any time. Re-read the page before relying on a selector.

## Page and navigation

- Resume page: `https://www.zhipin.com/web/geek/resume`
- Edit base information: `/web/geek/resume?editItem=userinfo`
- Personal information: `li[ka="resume_catalogue_click_baseInfo"]`
- Summary: `li[ka="resume_catalogue_click_userDesc"]`
- Expectations: `li[ka="resume_catalogue_click_expectList"]`
- Work: `li[ka="resume_catalogue_click_workExpList"]`
- Projects: `li[ka="resume_catalogue_click_projectExpList"]`
- Education: `li[ka="resume_catalogue_click_educationExpList"]`
- Certificates: `li[ka="resume_catalogue_click_certificationList"]`
- Skills: `li[ka="resume_catalogue_click_professionalSkill"]`

## Editors and saves

- Base information save: `button[ka="resume_form_baseinfo_ok"]`
- Base information cancel: `button[ka="resume_form_baseinfo_cancel"]`
- Summary edit: `a[ka="user-resume-edit-advantage"]`
- Summary save: `button[ka="resume_form_advantage_ok"]`
- Expectation edit links: `a[ka="user-resume-edit-expectation0"]`, increment the final number for each row.
- Expectation save: `button[ka="resume_form_expectation_ok"]`
- Work edit links: `a[ka="user-resume-edit-workexp0"]`, increment the final number.
- Work save: `button[ka="resume_form_work_ok"]`
- Education edit: `a[ka="user-resume-edit-eduexp0"]`
- Education save: `button[ka="resume_form_education_ok"]`
- Certificates edit: `a[ka="edit-certificate-click"]`
- Skills edit: `a[ka="user-resume-edit-professional-skill"]`
- Skills save: `button[ka="resume_form_professionalSkill_ok"]`

Do not edit project entries unless the user asks. The default project selector is `li[ka="user-resume-edit-project0"]`.

## Field setting

BOSS forms are framework-controlled. Set editable fields with the native prototype setter and dispatch both `input` and `change` events:

```js
const input = document.querySelector(selector);
const setter = Object.getOwnPropertyDescriptor(
  input instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype,
  "value",
).set;
setter.call(input, value);
input.dispatchEvent(new Event("input", { bubbles: true }));
input.dispatchEvent(new Event("change", { bubbles: true }));
```

Use the `fill` CLI command for individual fields. Use `eval --file` only when a custom dropdown or section requires coordinated clicks.

## Custom dropdowns

- Readonly inputs usually open a dialog rather than accepting direct text.
- For position search, click the input, fill `input[placeholder="请输入职位关键词"]`, then click the matching `.ui-dropmenu-list-item`.
- The custom-position `.confirm-button` can add the typed value when no canonical option is suitable.
- Industry options are visible `span` elements inside the industry dialog.
- Re-read after each selection because dialogs can replace the accessibility and element tree.

## Certificate editor

- Selected tags: `.cert-select-tags .cert-select-tag`
- Remove tag: `.cert-select-remove`
- Confirm: `.cert-select-form .btn-sure`

Removing tags deletes existing data. Obtain explicit user approval first.

## Deletion dialogs

Confirm is `span[ka="dialog_sure"]`; cancel is `span[ka="dialog_cancel"]`. Never confirm deletion unless the user explicitly requested it.

## Verification

After saving a section, read its rendered summary. At the end, reload the page, wait for `document.readyState === "complete"`, and verify:

- summary text;
- all expected positions;
- each work entry;
- education;
- certificate names;
- skills;
- project experience when it must be preserved.

## Known browser behavior

- Modern Edge refuses remote debugging when pointed directly at the normal user-data directory.
- Opening a temporary copy is required after the user signs in and closes Edge.
- Full Playwright attachment caused the observed BOSS page to close. Use a raw CDP WebSocket and a separate dummy tab instead.
- BOSS may redirect to `/web/passport/zp/verify.html`; pause and let the user solve it manually.

