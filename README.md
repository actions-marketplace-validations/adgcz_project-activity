# Github Project Activity

This action emails a summary of recent project activity in a repo and generates an artifact of the summary. 

see a sample summary (once viewing the sample, mouse over the link of an issue to see a tool tip summarising its flow through kanban columns):
    * <a href="http://htmlpreview.github.com/?https://github.com/adgcz/project-activity/blob/main/sample.html">sample email content</a>

## Inputs

### `token`

**Required** Github Token

### `smtp-server`

**Required** SMTP Server

### `smtp-server-port`

**Required** SMTP Server Port

### `auth-user`

**Required** Sender user email

### `auth-pwd`

**Required** Sender user password (for gmail, you can use an app password)

### `email-from`

**Required** Sender from name

### `recipient-emails`

**Required** Recipient email addresses (comma-separated)

### `project-numbers`

**Required** Project Numbers (comma-separated) or all

### `days`

**Required** Days back (number of days to query from current date backwards)

## Outputs

### artifact file with summary in html

## Example usage

```yaml
on:
  schedule:
    # * is a special character in YAML so you have to quote this string
    - cron:  '1 8 * * 1'
jobs:
    testing-project:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v2
            - name: Project changes past 7 days
              uses: adgcz/project-activity@v1
              id: project
              with:
                  token: ${{ secrets.GITHUB_TOKEN }}
                  smtp-server: "smtp.gmail.com"
                  smtp-server-port: "587"
                  auth-user: ${{ secrets.EMAIL_USER }}
                  auth-pwd: ${{ secrets.EMAIL_PWD }}
                  email-from: ${{ secrets.EMAIL_FROM }}
                  recipient-emails: ${{ secrets.RECIPIENT_EMAILS }}
                  project-numbers: all
                  days: 7
            - name: Upload summary to artifacts
              uses: actions/upload-artifact@v1
              with:
                  name: kanban
                  path: kanban
```