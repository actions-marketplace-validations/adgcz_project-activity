module.exports =
/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 2932:
/***/ ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__) => {

const core = __webpack_require__(2186);
const github = __webpack_require__(5438);
const { Octokit } = __webpack_require__(5375);
const nodemailer = __webpack_require__(4289);
const { dirname } = __webpack_require__(5622);
const { existsSync, appendFileSync } = __webpack_require__(5747);
const makeDir = __webpack_require__(9126);

async function run() {
    try {
        const token = core.getInput("token");
        // email inputs
        const smtpServer = core.getInput("smtp-server");
        const smtpServerPort = core.getInput("smtp-server-port");
        const authUser = core.getInput("auth-user"); // secret
        const authPwd = core.getInput("auth-pwd"); // secret
        const emailFrom = core.getInput("email-from");
        const recipientEmails = core.getInput("recipient-emails"); // secret
        // scope of data
        const projectNumbers = core.getInput("project-numbers"); // secret
        const phaseEndDate = core.getInput("phase-end-date"); //
        const phaseCalendarDays = core.getInput("days"); //

        const projectsToQuery = [];

        if (projectNumbers.toLowerCase() !== "all") {
            try {
                projectsToQuery = projectNumbers.split(",");
            } catch (error) {
                // invalid project number list
            }
        }

        let daysToQuery = 7;
        if (!isNaN(phaseCalendarDays)) {
            daysToQuery = parseInt(phaseCalendarDays);
        }

        const octokit = new Octokit({
            auth: token,
            previews: ["starfox-preview", "inertia-preview"],
        });
        const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");

        // get open projects in repo
        const repo_projects = await octokit.request(
            "GET /repos/:owner/:repo/projects",
            {
                owner,
                repo,
            }
        );

        // get repo issues updated in last 30 days
        const since = new Date(new Date().getTime() - (30 * 1000 * 3600 * 24));
        const issues_since = await octokit.request(
            'GET /repos/{owner}/{repo}/issues', 
            {
            owner,
            repo,
            since: since
            });

        // for issues updated in last 30 days, get removals and additions to projects
        const remove_events = [];
        for (let i = 0; i < issues_since.data.length; i++) {  

            const update_issue_events = await octokit.request(
                "GET /repos/{owner}/{repo}/issues/:issue_number/events",
                {
                    owner,
                    repo,
                    issue_number: issues_since.data[i].number, 
                }
            );  

            const removals = update_issue_events.data.filter(
                (ev) => {
                    return (
                        (ev.event === "removed_from_project" || ev.event === "added_to_project") 
                    )
                }
            );

            // sort date ascending
            removals.sort((a, b) =>
                a.created_at > b.created_at ? 1 : -1
            );

            // save relevant events for issue
            for(remove_ev in removals ){
                remove_events.push(
                    {
                        "issue_number": issues_since.data[i].number,
                        "event": removals[remove_ev].event,
                        "created_at": removals[remove_ev].created_at,
                        "html_url": issues_since.data[i].html_url,
                        "title": issues_since.data[i].title,
                        "project_id": removals[remove_ev].project_card.project_id
                    }
                );
            }
            
        } 

        // iterate projects in repo
        const projectKanbans = [];
        for (let p = 0; p < repo_projects.data.length; p++) {
            if (
                projectsToQuery.length === 0 ||
                projectsToQuery.toLowerCase() === "all" ||
                projectsToQuery.indexOf(
                    repo_projects.data[p].number.toString()
                ) > -1
            ) {
                // get columns for project
                const project_id = repo_projects.data[p].id;
                const columns = await octokit.request(
                    "GET /projects/:project_id/columns",
                    {
                        owner,
                        repo,
                        project_id: repo_projects.data[p].id,
                    }
                );

                // info for summary
                const kanbanColumns = columns.data.map(function (element) {
                    return {
                        name: element.name,
                        issues: [],
                    };
                });

                // removed issues - filter out those that were subsequently added back
                const removed_issues = remove_events.filter( (ev,i,array) => { 
                    if(ev.event.toString()==='removed_from_project' && ev.project_id===project_id) {   
                        for(let subsequent=i+1;subsequent < array.length;subsequent++ ){
                            if(array[subsequent].issue_number.toString() ===  ev.issue_number.toString() && array[subsequent].event === "added_to_project"){
                              return false; // ignore removals that were added back
                            }
                        }
                        return true; // keep removals not re-added
                    }else{
                        return false; // ignore adds
                    }
                });

                // iterate columns
                for (let col = 0; col < columns.data.length; col++) {
                    // get cards for column
                    const cards = await octokit.request(
                        "GET /projects/columns/:column_id/cards",
                        {
                            owner,
                            repo,
                            column_id: columns.data[col].id,
                        }
                    );

                    // iterate cards
                    for (columnCard in cards.data) {
                        // get card details
                        const card = await octokit.request(
                            "GET /projects/columns/cards/:card_id",
                            {
                                owner,
                                repo,
                                card_id: cards.data[columnCard].id,
                            }
                        );

                        // TODO: notes (currently ignored)
                        if (typeof card.data.content_url === "string") {
                            // determine issue number
                            const contentUrlParts = card.data.content_url.split(
                                "/"
                            );
                            const issue_number =
                                contentUrlParts[contentUrlParts.length - 1];

                            // GET REPO EVENTS
                            const issue_events = await octokit.request(
                                "GET /repos/:owner/:repo/issues/:issue_number/events",
                                {
                                    owner,
                                    repo,
                                    issue_number,
                                }
                            );

                            const events_summary = issue_events.data.map(
                                (ev) => {
                                    const Difference_In_Time =
                                        new Date(ev.created_at).getTime() -
                                        new Date().getTime();
                                    const Difference_In_Days = Math.round(
                                        Difference_In_Time / (1000 * 3600 * 24)
                                    );
                                    return {
                                        event: ev.event,
                                        days_ago: Difference_In_Days,
                                        project_card: ev.project_card,
                                        time_diff: Difference_In_Time,
                                    };
                                }
                            );

                            // sort by time
                            events_summary.sort((a, b) =>
                                a.time_diff > b.time_diff ? 1 : -1
                            );

                            // filter on time period
                            const relevant_events = [];

                            let issueGroup = 0;
                            // 0 - no change
                            // 1 - moved_columns_in_project
                            // 2 - added_to_project, converted_note_to_issue
                            // 3 - reopened
                            // 4 - closed
                            // 5 - removed_from_project (TODO)

                            for (let e = 0; e < events_summary.length; e++) {
                                // filter out events outside time range
                                if (
                                    Math.abs(events_summary[e].days_ago) <=
                                        daysToQuery &&
                                    events_summary[e].days_ago <= 0
                                ) {
                                    relevant_events.push(events_summary[e]);

                                    // most relevant change determines grouping
                                    if(events_summary[e].event ===
                                        "moved_columns_in_project" && issueGroup===0){
                                            issueGroup = 1;
                                    }
                                    if(events_summary[e].event === "added_to_project" || events_summary[e].event === "converted_note_to_issue"){
                                        issueGroup = 2;
                                    }
                                    if(events_summary[e].event === "reopened" ){
                                        issueGroup = 3;
                                    }                                                               
                                    if(events_summary[e].event === "closed" ){
                                        issueGroup = 4;
                                    } 
                                }
                            }

                            // describe flow between now and days ago
                            const flow = relevant_events
                                .map((ev, i, arr) => {
                                    return ev.project_card &&
                                        ev.project_card.column_name
                                        ? (i == 0 &&
                                          ev.project_card.previous_column_name
                                              ? ev.project_card
                                                    .previous_column_name +
                                                " -> "
                                              : "") +
                                              ev.project_card.column_name
                                        : ev.event;
                                })
                                .join(" -> ");

                            // get issue details (for title and html url)
                            const issue = await octokit.request(
                                "GET /repos/:owner/:repo/issues/:issue_number",
                                {
                                    owner,
                                    repo,
                                    issue_number,
                                }
                            );

                            const issue_comments = await octokit.request(
                                "/repos/:owner/:repo/issues/:issue_number/comments",
                                {
                                    owner,
                                    repo,
                                    issue_number,
                                }
                            );

                            const total_comments = issue_comments.data.length;
                            const period_comments = issue_comments.data.filter(
                                function (comment) {
                                    const Difference_In_Time =
                                        new Date(comment.created_at).getTime() -
                                        new Date().getTime();
                                    const Difference_In_Days = Math.round(
                                        Difference_In_Time / (1000 * 3600 * 24)
                                    );
                                    return (
                                        Math.abs(Difference_In_Days) <=
                                        daysToQuery
                                    );
                                }
                            ).length;

                            // store card for email content
                            kanbanColumns[col].issues.push({
                                id: issue_number,
                                html_url: issue.data.html_url,
                                title: issue.data.title,
                                group: issueGroup,
                                flow: flow,
                                total_comments: total_comments,
                                period_comments: period_comments,
                            });
                        } else {
                            console.log("ignoring note");
                        }
                    }
                    // sort by group (0-unchanged, 1-moved, 2-added)
                    kanbanColumns[col].issues.sort((a, b) =>
                        a.group > b.group ? 1 : -1
                    );
                }

                projectKanbans.push(
                    drawKanban(
                        repo_projects.data[p].name,
                        repo_projects.data[p].html_url,
                        kanbanColumns,
                        daysToQuery,
                        removed_issues
                    )
                );

            }
        }

        // TODO: can CSS be input?
        const cssStyle =
            "<head><style>" +
            " ul {padding: 12px;} ul li {list-style-type: circle;}" +
            " .removed {align: center; width: 100%; padding: 4px; vertical-align: top; text-align:left;} "+
            " .project {overflow-x:auto; text-align: center; } " +
            " .projectname {font-size:large; font-weight: bold; } " +
            " a.comments {color:purple; font-style: italic; font-size: small; font-weight: bold;} " +
            " .grouphead  {font-style: italic; text-align: center; }" +
            " .grouping0  {background-color: #f0efef;  border-radius: 6px; border: 1px solid #bbbbbb; padding: 8px; }" +
            " .grouping1  {background-color: #ddeedd;  border-radius: 6px; border: 1px solid #bbbbbb; padding: 8px; }" +
            " .grouping2  {background-color: #c2d4dd;  border-radius: 6px; border: 1px solid #bbbbbb; padding: 8px; }" +
            " .grouping3  {background-color: #eaece5;  border-radius: 6px; border: 1px solid #bbbbbb; padding: 8px; }" +
            " .grouping4  {background-color: #b2c2bf;  border-radius: 6px; border: 1px solid #bbbbbb; padding: 8px; }" +
            " .grouping5  {background-color: #f0efef;  border-radius: 6px; border: 1px solid #bbbbbb; padding: 8px; }" +            " .column { font-weight: bold; text-align: center;    }" +
            " table { width: 100%; padding: 4px; border-spacing: 4px;}" +
            " td {background-color: #f0efef; width:150px; padding: 8px; vertical-align: top; text-align:left; border: 1px solid #cccccc;  border-radius: 6px;} " +
            " </style></head>";

        // save snapshot as artifact for action run
        const path = "kanban/index.html";
        await makeDir(dirname(path));
        appendFileSync(
            path,
            "<html>" +
                cssStyle +
                "<body>" +
                projectKanbans.join("") +
                "</body></html>"
        );

        // email kanbans
        // TODO: validate recipients and other email input
        if (recipientEmails.indexOf("@") > -1) {
            let subject =
                "Project activity " +
                owner +
                "/" +
                repo +
                " - past " +
                daysToQuery +
                " days";
            let isTLS = false;
            const transport = nodemailer.createTransport({
                host: smtpServer,
                port: smtpServerPort,
                secure: isTLS,
                auth: {
                    user: authUser,
                    pass: authPwd,
                },
            });
            const info = await transport.sendMail({
                from: get_from(emailFrom, authUser),
                to: recipientEmails,
                subject: subject,
                html: cssStyle + projectKanbans.join(""),
            });
        }
    } catch (error) {
        core.setFailed(error.message);
    }
}

function get_from(from, username) {
    if (from.match(/.+<.+@.+>/)) {
        return from;
    }
    return `"${from}" <${username}>`;
}

function drawKanban(projectName, projectUrl, columns, days_ago, removedIssues) {
    const today = new Date();
    const groups = ["No change", "Moved here", "Added","Reopened","Closed","Removed"];
    return (
        '<br/><div class="project"><span class="projectname"><a href="'+projectUrl+'">' +
        projectName +
        "</a></span><br/>" +
        " past " +
        days_ago +
        " days activity (as at " +
        today.getDate() +
        "/" +
        (today.getMonth() + 1) +
        "/" +
        today.getFullYear() +
        ")" +
        (removedIssues.length>0 ? '<div class="removed"><span class="grouphead">Removed issues</span><br/>'+
        removedIssues.map((issue) => {
            return (
                '<a title="" href="'+issue.html_url+'" class="group0">' +
                issue.title +
                "</a> " 
            );
        }).join("") +'</div>'
    :'')+
        "<table><tr>" +
        columns
            .map(function (element) {
                return (
                    '<td><div class="column">' +
                    element.name +
                    "</div>" +
                    (element.issues.length === 0
                        ? '<div style="text-align:center;">No issues</div>'
                        : element.issues
                              .map((issue, i, arr) => {
                                  return (
                                      (i > 0 && arr[i - 1].group !== issue.group
                                          ? "</div>"
                                          : "") +
                                      (i === 0 ||
                                      arr[i - 1].group !== issue.group
                                          ? '<br/><div class="grouping' +
                                            issue.group +
                                            '"><div class="grouphead">' +
                                            groups[issue.group] +
                                            "</div>"
                                          : "") +
                                      '<li><a title="' +
                                      issue.flow +
                                      '" href="' +
                                      issue.html_url +
                                      '" class="group' +
                                      issue.group +
                                      '">' +
                                      issue.title +
                                      "</a> " +
                                      (issue.period_comments > 0
                                          ? ' <a class="comments" title="' +
                                            issue.period_comments +
                                            " of " +
                                            issue.total_comments +
                                            '" href="' +
                                            issue.html_url +
                                            '">new comments</a>'
                                          : "") +
                                      "</li>" +
                                      (i === arr.length - 1 ? "</div>" : "")
                                  );
                              })
                              .join("")) +
                    "</td>"
                );
            })
            .join("") +
        "</tr></table>"+
        "</div><br/>"
    );
}

run();


/***/ }),

/***/ 7351:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

"use strict";

var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
const os = __importStar(__webpack_require__(2087));
/**
 * Commands
 *
 * Command Format:
 *   ::name key=value,key=value::message
 *
 * Examples:
 *   ::warning::This is the message
 *   ::set-env name=MY_VAR::some value
 */
function issueCommand(command, properties, message) {
    const cmd = new Command(command, properties, message);
    process.stdout.write(cmd.toString() + os.EOL);
}
exports.issueCommand = issueCommand;
function issue(name, message = '') {
    issueCommand(name, {}, message);
}
exports.issue = issue;
const CMD_STRING = '::';
class Command {
    constructor(command, properties, message) {
        if (!command) {
            command = 'missing.command';
        }
        this.command = command;
        this.properties = properties;
        this.message = message;
    }
    toString() {
        let cmdStr = CMD_STRING + this.command;
        if (this.properties && Object.keys(this.properties).length > 0) {
            cmdStr += ' ';
            let first = true;
            for (const key in this.properties) {
                if (this.properties.hasOwnProperty(key)) {
                    const val = this.properties[key];
                    if (val) {
                        if (first) {
                            first = false;
                        }
                        else {
                            cmdStr += ',';
                        }
                        cmdStr += `${key}=${escapeProperty(val)}`;
                    }
                }
            }
        }
        cmdStr += `${CMD_STRING}${escapeData(this.message)}`;
        return cmdStr;
    }
}
/**
 * Sanitizes an input into a string so it can be passed into issueCommand safely
 * @param input input to sanitize into a string
 */
function toCommandValue(input) {
    if (input === null || input === undefined) {
        return '';
    }
    else if (typeof input === 'string' || input instanceof String) {
        return input;
    }
    return JSON.stringify(input);
}
exports.toCommandValue = toCommandValue;
function escapeData(s) {
    return toCommandValue(s)
        .replace(/%/g, '%25')
        .replace(/\r/g, '%0D')
        .replace(/\n/g, '%0A');
}
function escapeProperty(s) {
    return toCommandValue(s)
        .replace(/%/g, '%25')
        .replace(/\r/g, '%0D')
        .replace(/\n/g, '%0A')
        .replace(/:/g, '%3A')
        .replace(/,/g, '%2C');
}
//# sourceMappingURL=command.js.map

/***/ }),

/***/ 2186:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

"use strict";

var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
const command_1 = __webpack_require__(7351);
const os = __importStar(__webpack_require__(2087));
const path = __importStar(__webpack_require__(5622));
/**
 * The code to exit an action
 */
var ExitCode;
(function (ExitCode) {
    /**
     * A code indicating that the action was successful
     */
    ExitCode[ExitCode["Success"] = 0] = "Success";
    /**
     * A code indicating that the action was a failure
     */
    ExitCode[ExitCode["Failure"] = 1] = "Failure";
})(ExitCode = exports.ExitCode || (exports.ExitCode = {}));
//-----------------------------------------------------------------------
// Variables
//-----------------------------------------------------------------------
/**
 * Sets env variable for this action and future actions in the job
 * @param name the name of the variable to set
 * @param val the value of the variable. Non-string values will be converted to a string via JSON.stringify
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function exportVariable(name, val) {
    const convertedVal = command_1.toCommandValue(val);
    process.env[name] = convertedVal;
    command_1.issueCommand('set-env', { name }, convertedVal);
}
exports.exportVariable = exportVariable;
/**
 * Registers a secret which will get masked from logs
 * @param secret value of the secret
 */
function setSecret(secret) {
    command_1.issueCommand('add-mask', {}, secret);
}
exports.setSecret = setSecret;
/**
 * Prepends inputPath to the PATH (for this action and future actions)
 * @param inputPath
 */
function addPath(inputPath) {
    command_1.issueCommand('add-path', {}, inputPath);
    process.env['PATH'] = `${inputPath}${path.delimiter}${process.env['PATH']}`;
}
exports.addPath = addPath;
/**
 * Gets the value of an input.  The value is also trimmed.
 *
 * @param     name     name of the input to get
 * @param     options  optional. See InputOptions.
 * @returns   string
 */
function getInput(name, options) {
    const val = process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] || '';
    if (options && options.required && !val) {
        throw new Error(`Input required and not supplied: ${name}`);
    }
    return val.trim();
}
exports.getInput = getInput;
/**
 * Sets the value of an output.
 *
 * @param     name     name of the output to set
 * @param     value    value to store. Non-string values will be converted to a string via JSON.stringify
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setOutput(name, value) {
    command_1.issueCommand('set-output', { name }, value);
}
exports.setOutput = setOutput;
/**
 * Enables or disables the echoing of commands into stdout for the rest of the step.
 * Echoing is disabled by default if ACTIONS_STEP_DEBUG is not set.
 *
 */
function setCommandEcho(enabled) {
    command_1.issue('echo', enabled ? 'on' : 'off');
}
exports.setCommandEcho = setCommandEcho;
//-----------------------------------------------------------------------
// Results
//-----------------------------------------------------------------------
/**
 * Sets the action status to failed.
 * When the action exits it will be with an exit code of 1
 * @param message add error issue message
 */
function setFailed(message) {
    process.exitCode = ExitCode.Failure;
    error(message);
}
exports.setFailed = setFailed;
//-----------------------------------------------------------------------
// Logging Commands
//-----------------------------------------------------------------------
/**
 * Gets whether Actions Step Debug is on or not
 */
function isDebug() {
    return process.env['RUNNER_DEBUG'] === '1';
}
exports.isDebug = isDebug;
/**
 * Writes debug message to user log
 * @param message debug message
 */
function debug(message) {
    command_1.issueCommand('debug', {}, message);
}
exports.debug = debug;
/**
 * Adds an error issue
 * @param message error issue message. Errors will be converted to string via toString()
 */
function error(message) {
    command_1.issue('error', message instanceof Error ? message.toString() : message);
}
exports.error = error;
/**
 * Adds an warning issue
 * @param message warning issue message. Errors will be converted to string via toString()
 */
function warning(message) {
    command_1.issue('warning', message instanceof Error ? message.toString() : message);
}
exports.warning = warning;
/**
 * Writes info to log with console.log.
 * @param message info message
 */
function info(message) {
    process.stdout.write(message + os.EOL);
}
exports.info = info;
/**
 * Begin an output group.
 *
 * Output until the next `groupEnd` will be foldable in this group
 *
 * @param name The name of the output group
 */
function startGroup(name) {
    command_1.issue('group', name);
}
exports.startGroup = startGroup;
/**
 * End an output group.
 */
function endGroup() {
    command_1.issue('endgroup');
}
exports.endGroup = endGroup;
/**
 * Wrap an asynchronous function call in a group.
 *
 * Returns the same type as the function itself.
 *
 * @param name The name of the group
 * @param fn The function to wrap in the group
 */
function group(name, fn) {
    return __awaiter(this, void 0, void 0, function* () {
        startGroup(name);
        let result;
        try {
            result = yield fn();
        }
        finally {
            endGroup();
        }
        return result;
    });
}
exports.group = group;
//-----------------------------------------------------------------------
// Wrapper action state
//-----------------------------------------------------------------------
/**
 * Saves state for current action, the state can only be retrieved by this action's post job execution.
 *
 * @param     name     name of the state to store
 * @param     value    value to store. Non-string values will be converted to a string via JSON.stringify
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function saveState(name, value) {
    command_1.issueCommand('save-state', { name }, value);
}
exports.saveState = saveState;
/**
 * Gets the value of an state set by this action's main execution.
 *
 * @param     name     name of the state to get
 * @returns   string
 */
function getState(name) {
    return process.env[`STATE_${name}`] || '';
}
exports.getState = getState;
//# sourceMappingURL=core.js.map

/***/ }),

/***/ 4087:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Context = void 0;
const fs_1 = __webpack_require__(5747);
const os_1 = __webpack_require__(2087);
class Context {
    /**
     * Hydrate the context from the environment
     */
    constructor() {
        this.payload = {};
        if (process.env.GITHUB_EVENT_PATH) {
            if (fs_1.existsSync(process.env.GITHUB_EVENT_PATH)) {
                this.payload = JSON.parse(fs_1.readFileSync(process.env.GITHUB_EVENT_PATH, { encoding: 'utf8' }));
            }
            else {
                const path = process.env.GITHUB_EVENT_PATH;
                process.stdout.write(`GITHUB_EVENT_PATH ${path} does not exist${os_1.EOL}`);
            }
        }
        this.eventName = process.env.GITHUB_EVENT_NAME;
        this.sha = process.env.GITHUB_SHA;
        this.ref = process.env.GITHUB_REF;
        this.workflow = process.env.GITHUB_WORKFLOW;
        this.action = process.env.GITHUB_ACTION;
        this.actor = process.env.GITHUB_ACTOR;
        this.job = process.env.GITHUB_JOB;
        this.runNumber = parseInt(process.env.GITHUB_RUN_NUMBER, 10);
        this.runId = parseInt(process.env.GITHUB_RUN_ID, 10);
    }
    get issue() {
        const payload = this.payload;
        return Object.assign(Object.assign({}, this.repo), { number: (payload.issue || payload.pull_request || payload).number });
    }
    get repo() {
        if (process.env.GITHUB_REPOSITORY) {
            const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
            return { owner, repo };
        }
        if (this.payload.repository) {
            return {
                owner: this.payload.repository.owner.login,
                repo: this.payload.repository.name
            };
        }
        throw new Error("context.repo requires a GITHUB_REPOSITORY environment variable like 'owner/repo'");
    }
}
exports.Context = Context;
//# sourceMappingURL=context.js.map

/***/ }),

/***/ 5438:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

"use strict";

var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.getOctokit = exports.context = void 0;
const Context = __importStar(__webpack_require__(4087));
const utils_1 = __webpack_require__(3030);
exports.context = new Context.Context();
/**
 * Returns a hydrated octokit ready to use for GitHub Actions
 *
 * @param     token    the repo PAT or GITHUB_TOKEN
 * @param     options  other options to set
 */
function getOctokit(token, options) {
    return new utils_1.GitHub(utils_1.getOctokitOptions(token, options));
}
exports.getOctokit = getOctokit;
//# sourceMappingURL=github.js.map

/***/ }),

/***/ 7914:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

"use strict";

var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.getApiBaseUrl = exports.getProxyAgent = exports.getAuthString = void 0;
const httpClient = __importStar(__webpack_require__(9925));
function getAuthString(token, options) {
    if (!token && !options.auth) {
        throw new Error('Parameter token or opts.auth is required');
    }
    else if (token && options.auth) {
        throw new Error('Parameters token and opts.auth may not both be specified');
    }
    return typeof options.auth === 'string' ? options.auth : `token ${token}`;
}
exports.getAuthString = getAuthString;
function getProxyAgent(destinationUrl) {
    const hc = new httpClient.HttpClient();
    return hc.getAgent(destinationUrl);
}
exports.getProxyAgent = getProxyAgent;
function getApiBaseUrl() {
    return process.env['GITHUB_API_URL'] || 'https://api.github.com';
}
exports.getApiBaseUrl = getApiBaseUrl;
//# sourceMappingURL=utils.js.map

/***/ }),

/***/ 3030:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

"use strict";

var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.getOctokitOptions = exports.GitHub = exports.context = void 0;
const Context = __importStar(__webpack_require__(4087));
const Utils = __importStar(__webpack_require__(7914));
// octokit + plugins
const core_1 = __webpack_require__(6762);
const plugin_rest_endpoint_methods_1 = __webpack_require__(3044);
const plugin_paginate_rest_1 = __webpack_require__(4193);
exports.context = new Context.Context();
const baseUrl = Utils.getApiBaseUrl();
const defaults = {
    baseUrl,
    request: {
        agent: Utils.getProxyAgent(baseUrl)
    }
};
exports.GitHub = core_1.Octokit.plugin(plugin_rest_endpoint_methods_1.restEndpointMethods, plugin_paginate_rest_1.paginateRest).defaults(defaults);
/**
 * Convience function to correctly format Octokit Options to pass into the constructor.
 *
 * @param     token    the repo PAT or GITHUB_TOKEN
 * @param     options  other options to set
 */
function getOctokitOptions(token, options) {
    const opts = Object.assign({}, options || {}); // Shallow clone - don't mutate the object provided by the caller
    // Auth
    const auth = Utils.getAuthString(token, opts);
    if (auth) {
        opts.auth = auth;
    }
    return opts;
}
exports.getOctokitOptions = getOctokitOptions;
//# sourceMappingURL=utils.js.map

/***/ }),

/***/ 9925:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
const url = __webpack_require__(8835);
const http = __webpack_require__(8605);
const https = __webpack_require__(7211);
const pm = __webpack_require__(6443);
let tunnel;
var HttpCodes;
(function (HttpCodes) {
    HttpCodes[HttpCodes["OK"] = 200] = "OK";
    HttpCodes[HttpCodes["MultipleChoices"] = 300] = "MultipleChoices";
    HttpCodes[HttpCodes["MovedPermanently"] = 301] = "MovedPermanently";
    HttpCodes[HttpCodes["ResourceMoved"] = 302] = "ResourceMoved";
    HttpCodes[HttpCodes["SeeOther"] = 303] = "SeeOther";
    HttpCodes[HttpCodes["NotModified"] = 304] = "NotModified";
    HttpCodes[HttpCodes["UseProxy"] = 305] = "UseProxy";
    HttpCodes[HttpCodes["SwitchProxy"] = 306] = "SwitchProxy";
    HttpCodes[HttpCodes["TemporaryRedirect"] = 307] = "TemporaryRedirect";
    HttpCodes[HttpCodes["PermanentRedirect"] = 308] = "PermanentRedirect";
    HttpCodes[HttpCodes["BadRequest"] = 400] = "BadRequest";
    HttpCodes[HttpCodes["Unauthorized"] = 401] = "Unauthorized";
    HttpCodes[HttpCodes["PaymentRequired"] = 402] = "PaymentRequired";
    HttpCodes[HttpCodes["Forbidden"] = 403] = "Forbidden";
    HttpCodes[HttpCodes["NotFound"] = 404] = "NotFound";
    HttpCodes[HttpCodes["MethodNotAllowed"] = 405] = "MethodNotAllowed";
    HttpCodes[HttpCodes["NotAcceptable"] = 406] = "NotAcceptable";
    HttpCodes[HttpCodes["ProxyAuthenticationRequired"] = 407] = "ProxyAuthenticationRequired";
    HttpCodes[HttpCodes["RequestTimeout"] = 408] = "RequestTimeout";
    HttpCodes[HttpCodes["Conflict"] = 409] = "Conflict";
    HttpCodes[HttpCodes["Gone"] = 410] = "Gone";
    HttpCodes[HttpCodes["TooManyRequests"] = 429] = "TooManyRequests";
    HttpCodes[HttpCodes["InternalServerError"] = 500] = "InternalServerError";
    HttpCodes[HttpCodes["NotImplemented"] = 501] = "NotImplemented";
    HttpCodes[HttpCodes["BadGateway"] = 502] = "BadGateway";
    HttpCodes[HttpCodes["ServiceUnavailable"] = 503] = "ServiceUnavailable";
    HttpCodes[HttpCodes["GatewayTimeout"] = 504] = "GatewayTimeout";
})(HttpCodes = exports.HttpCodes || (exports.HttpCodes = {}));
var Headers;
(function (Headers) {
    Headers["Accept"] = "accept";
    Headers["ContentType"] = "content-type";
})(Headers = exports.Headers || (exports.Headers = {}));
var MediaTypes;
(function (MediaTypes) {
    MediaTypes["ApplicationJson"] = "application/json";
})(MediaTypes = exports.MediaTypes || (exports.MediaTypes = {}));
/**
 * Returns the proxy URL, depending upon the supplied url and proxy environment variables.
 * @param serverUrl  The server URL where the request will be sent. For example, https://api.github.com
 */
function getProxyUrl(serverUrl) {
    let proxyUrl = pm.getProxyUrl(url.parse(serverUrl));
    return proxyUrl ? proxyUrl.href : '';
}
exports.getProxyUrl = getProxyUrl;
const HttpRedirectCodes = [
    HttpCodes.MovedPermanently,
    HttpCodes.ResourceMoved,
    HttpCodes.SeeOther,
    HttpCodes.TemporaryRedirect,
    HttpCodes.PermanentRedirect
];
const HttpResponseRetryCodes = [
    HttpCodes.BadGateway,
    HttpCodes.ServiceUnavailable,
    HttpCodes.GatewayTimeout
];
const RetryableHttpVerbs = ['OPTIONS', 'GET', 'DELETE', 'HEAD'];
const ExponentialBackoffCeiling = 10;
const ExponentialBackoffTimeSlice = 5;
class HttpClientResponse {
    constructor(message) {
        this.message = message;
    }
    readBody() {
        return new Promise(async (resolve, reject) => {
            let output = Buffer.alloc(0);
            this.message.on('data', (chunk) => {
                output = Buffer.concat([output, chunk]);
            });
            this.message.on('end', () => {
                resolve(output.toString());
            });
        });
    }
}
exports.HttpClientResponse = HttpClientResponse;
function isHttps(requestUrl) {
    let parsedUrl = url.parse(requestUrl);
    return parsedUrl.protocol === 'https:';
}
exports.isHttps = isHttps;
class HttpClient {
    constructor(userAgent, handlers, requestOptions) {
        this._ignoreSslError = false;
        this._allowRedirects = true;
        this._allowRedirectDowngrade = false;
        this._maxRedirects = 50;
        this._allowRetries = false;
        this._maxRetries = 1;
        this._keepAlive = false;
        this._disposed = false;
        this.userAgent = userAgent;
        this.handlers = handlers || [];
        this.requestOptions = requestOptions;
        if (requestOptions) {
            if (requestOptions.ignoreSslError != null) {
                this._ignoreSslError = requestOptions.ignoreSslError;
            }
            this._socketTimeout = requestOptions.socketTimeout;
            if (requestOptions.allowRedirects != null) {
                this._allowRedirects = requestOptions.allowRedirects;
            }
            if (requestOptions.allowRedirectDowngrade != null) {
                this._allowRedirectDowngrade = requestOptions.allowRedirectDowngrade;
            }
            if (requestOptions.maxRedirects != null) {
                this._maxRedirects = Math.max(requestOptions.maxRedirects, 0);
            }
            if (requestOptions.keepAlive != null) {
                this._keepAlive = requestOptions.keepAlive;
            }
            if (requestOptions.allowRetries != null) {
                this._allowRetries = requestOptions.allowRetries;
            }
            if (requestOptions.maxRetries != null) {
                this._maxRetries = requestOptions.maxRetries;
            }
        }
    }
    options(requestUrl, additionalHeaders) {
        return this.request('OPTIONS', requestUrl, null, additionalHeaders || {});
    }
    get(requestUrl, additionalHeaders) {
        return this.request('GET', requestUrl, null, additionalHeaders || {});
    }
    del(requestUrl, additionalHeaders) {
        return this.request('DELETE', requestUrl, null, additionalHeaders || {});
    }
    post(requestUrl, data, additionalHeaders) {
        return this.request('POST', requestUrl, data, additionalHeaders || {});
    }
    patch(requestUrl, data, additionalHeaders) {
        return this.request('PATCH', requestUrl, data, additionalHeaders || {});
    }
    put(requestUrl, data, additionalHeaders) {
        return this.request('PUT', requestUrl, data, additionalHeaders || {});
    }
    head(requestUrl, additionalHeaders) {
        return this.request('HEAD', requestUrl, null, additionalHeaders || {});
    }
    sendStream(verb, requestUrl, stream, additionalHeaders) {
        return this.request(verb, requestUrl, stream, additionalHeaders);
    }
    /**
     * Gets a typed object from an endpoint
     * Be aware that not found returns a null.  Other errors (4xx, 5xx) reject the promise
     */
    async getJson(requestUrl, additionalHeaders = {}) {
        additionalHeaders[Headers.Accept] = this._getExistingOrDefaultHeader(additionalHeaders, Headers.Accept, MediaTypes.ApplicationJson);
        let res = await this.get(requestUrl, additionalHeaders);
        return this._processResponse(res, this.requestOptions);
    }
    async postJson(requestUrl, obj, additionalHeaders = {}) {
        let data = JSON.stringify(obj, null, 2);
        additionalHeaders[Headers.Accept] = this._getExistingOrDefaultHeader(additionalHeaders, Headers.Accept, MediaTypes.ApplicationJson);
        additionalHeaders[Headers.ContentType] = this._getExistingOrDefaultHeader(additionalHeaders, Headers.ContentType, MediaTypes.ApplicationJson);
        let res = await this.post(requestUrl, data, additionalHeaders);
        return this._processResponse(res, this.requestOptions);
    }
    async putJson(requestUrl, obj, additionalHeaders = {}) {
        let data = JSON.stringify(obj, null, 2);
        additionalHeaders[Headers.Accept] = this._getExistingOrDefaultHeader(additionalHeaders, Headers.Accept, MediaTypes.ApplicationJson);
        additionalHeaders[Headers.ContentType] = this._getExistingOrDefaultHeader(additionalHeaders, Headers.ContentType, MediaTypes.ApplicationJson);
        let res = await this.put(requestUrl, data, additionalHeaders);
        return this._processResponse(res, this.requestOptions);
    }
    async patchJson(requestUrl, obj, additionalHeaders = {}) {
        let data = JSON.stringify(obj, null, 2);
        additionalHeaders[Headers.Accept] = this._getExistingOrDefaultHeader(additionalHeaders, Headers.Accept, MediaTypes.ApplicationJson);
        additionalHeaders[Headers.ContentType] = this._getExistingOrDefaultHeader(additionalHeaders, Headers.ContentType, MediaTypes.ApplicationJson);
        let res = await this.patch(requestUrl, data, additionalHeaders);
        return this._processResponse(res, this.requestOptions);
    }
    /**
     * Makes a raw http request.
     * All other methods such as get, post, patch, and request ultimately call this.
     * Prefer get, del, post and patch
     */
    async request(verb, requestUrl, data, headers) {
        if (this._disposed) {
            throw new Error('Client has already been disposed.');
        }
        let parsedUrl = url.parse(requestUrl);
        let info = this._prepareRequest(verb, parsedUrl, headers);
        // Only perform retries on reads since writes may not be idempotent.
        let maxTries = this._allowRetries && RetryableHttpVerbs.indexOf(verb) != -1
            ? this._maxRetries + 1
            : 1;
        let numTries = 0;
        let response;
        while (numTries < maxTries) {
            response = await this.requestRaw(info, data);
            // Check if it's an authentication challenge
            if (response &&
                response.message &&
                response.message.statusCode === HttpCodes.Unauthorized) {
                let authenticationHandler;
                for (let i = 0; i < this.handlers.length; i++) {
                    if (this.handlers[i].canHandleAuthentication(response)) {
                        authenticationHandler = this.handlers[i];
                        break;
                    }
                }
                if (authenticationHandler) {
                    return authenticationHandler.handleAuthentication(this, info, data);
                }
                else {
                    // We have received an unauthorized response but have no handlers to handle it.
                    // Let the response return to the caller.
                    return response;
                }
            }
            let redirectsRemaining = this._maxRedirects;
            while (HttpRedirectCodes.indexOf(response.message.statusCode) != -1 &&
                this._allowRedirects &&
                redirectsRemaining > 0) {
                const redirectUrl = response.message.headers['location'];
                if (!redirectUrl) {
                    // if there's no location to redirect to, we won't
                    break;
                }
                let parsedRedirectUrl = url.parse(redirectUrl);
                if (parsedUrl.protocol == 'https:' &&
                    parsedUrl.protocol != parsedRedirectUrl.protocol &&
                    !this._allowRedirectDowngrade) {
                    throw new Error('Redirect from HTTPS to HTTP protocol. This downgrade is not allowed for security reasons. If you want to allow this behavior, set the allowRedirectDowngrade option to true.');
                }
                // we need to finish reading the response before reassigning response
                // which will leak the open socket.
                await response.readBody();
                // strip authorization header if redirected to a different hostname
                if (parsedRedirectUrl.hostname !== parsedUrl.hostname) {
                    for (let header in headers) {
                        // header names are case insensitive
                        if (header.toLowerCase() === 'authorization') {
                            delete headers[header];
                        }
                    }
                }
                // let's make the request with the new redirectUrl
                info = this._prepareRequest(verb, parsedRedirectUrl, headers);
                response = await this.requestRaw(info, data);
                redirectsRemaining--;
            }
            if (HttpResponseRetryCodes.indexOf(response.message.statusCode) == -1) {
                // If not a retry code, return immediately instead of retrying
                return response;
            }
            numTries += 1;
            if (numTries < maxTries) {
                await response.readBody();
                await this._performExponentialBackoff(numTries);
            }
        }
        return response;
    }
    /**
     * Needs to be called if keepAlive is set to true in request options.
     */
    dispose() {
        if (this._agent) {
            this._agent.destroy();
        }
        this._disposed = true;
    }
    /**
     * Raw request.
     * @param info
     * @param data
     */
    requestRaw(info, data) {
        return new Promise((resolve, reject) => {
            let callbackForResult = function (err, res) {
                if (err) {
                    reject(err);
                }
                resolve(res);
            };
            this.requestRawWithCallback(info, data, callbackForResult);
        });
    }
    /**
     * Raw request with callback.
     * @param info
     * @param data
     * @param onResult
     */
    requestRawWithCallback(info, data, onResult) {
        let socket;
        if (typeof data === 'string') {
            info.options.headers['Content-Length'] = Buffer.byteLength(data, 'utf8');
        }
        let callbackCalled = false;
        let handleResult = (err, res) => {
            if (!callbackCalled) {
                callbackCalled = true;
                onResult(err, res);
            }
        };
        let req = info.httpModule.request(info.options, (msg) => {
            let res = new HttpClientResponse(msg);
            handleResult(null, res);
        });
        req.on('socket', sock => {
            socket = sock;
        });
        // If we ever get disconnected, we want the socket to timeout eventually
        req.setTimeout(this._socketTimeout || 3 * 60000, () => {
            if (socket) {
                socket.end();
            }
            handleResult(new Error('Request timeout: ' + info.options.path), null);
        });
        req.on('error', function (err) {
            // err has statusCode property
            // res should have headers
            handleResult(err, null);
        });
        if (data && typeof data === 'string') {
            req.write(data, 'utf8');
        }
        if (data && typeof data !== 'string') {
            data.on('close', function () {
                req.end();
            });
            data.pipe(req);
        }
        else {
            req.end();
        }
    }
    /**
     * Gets an http agent. This function is useful when you need an http agent that handles
     * routing through a proxy server - depending upon the url and proxy environment variables.
     * @param serverUrl  The server URL where the request will be sent. For example, https://api.github.com
     */
    getAgent(serverUrl) {
        let parsedUrl = url.parse(serverUrl);
        return this._getAgent(parsedUrl);
    }
    _prepareRequest(method, requestUrl, headers) {
        const info = {};
        info.parsedUrl = requestUrl;
        const usingSsl = info.parsedUrl.protocol === 'https:';
        info.httpModule = usingSsl ? https : http;
        const defaultPort = usingSsl ? 443 : 80;
        info.options = {};
        info.options.host = info.parsedUrl.hostname;
        info.options.port = info.parsedUrl.port
            ? parseInt(info.parsedUrl.port)
            : defaultPort;
        info.options.path =
            (info.parsedUrl.pathname || '') + (info.parsedUrl.search || '');
        info.options.method = method;
        info.options.headers = this._mergeHeaders(headers);
        if (this.userAgent != null) {
            info.options.headers['user-agent'] = this.userAgent;
        }
        info.options.agent = this._getAgent(info.parsedUrl);
        // gives handlers an opportunity to participate
        if (this.handlers) {
            this.handlers.forEach(handler => {
                handler.prepareRequest(info.options);
            });
        }
        return info;
    }
    _mergeHeaders(headers) {
        const lowercaseKeys = obj => Object.keys(obj).reduce((c, k) => ((c[k.toLowerCase()] = obj[k]), c), {});
        if (this.requestOptions && this.requestOptions.headers) {
            return Object.assign({}, lowercaseKeys(this.requestOptions.headers), lowercaseKeys(headers));
        }
        return lowercaseKeys(headers || {});
    }
    _getExistingOrDefaultHeader(additionalHeaders, header, _default) {
        const lowercaseKeys = obj => Object.keys(obj).reduce((c, k) => ((c[k.toLowerCase()] = obj[k]), c), {});
        let clientHeader;
        if (this.requestOptions && this.requestOptions.headers) {
            clientHeader = lowercaseKeys(this.requestOptions.headers)[header];
        }
        return additionalHeaders[header] || clientHeader || _default;
    }
    _getAgent(parsedUrl) {
        let agent;
        let proxyUrl = pm.getProxyUrl(parsedUrl);
        let useProxy = proxyUrl && proxyUrl.hostname;
        if (this._keepAlive && useProxy) {
            agent = this._proxyAgent;
        }
        if (this._keepAlive && !useProxy) {
            agent = this._agent;
        }
        // if agent is already assigned use that agent.
        if (!!agent) {
            return agent;
        }
        const usingSsl = parsedUrl.protocol === 'https:';
        let maxSockets = 100;
        if (!!this.requestOptions) {
            maxSockets = this.requestOptions.maxSockets || http.globalAgent.maxSockets;
        }
        if (useProxy) {
            // If using proxy, need tunnel
            if (!tunnel) {
                tunnel = __webpack_require__(4294);
            }
            const agentOptions = {
                maxSockets: maxSockets,
                keepAlive: this._keepAlive,
                proxy: {
                    proxyAuth: proxyUrl.auth,
                    host: proxyUrl.hostname,
                    port: proxyUrl.port
                }
            };
            let tunnelAgent;
            const overHttps = proxyUrl.protocol === 'https:';
            if (usingSsl) {
                tunnelAgent = overHttps ? tunnel.httpsOverHttps : tunnel.httpsOverHttp;
            }
            else {
                tunnelAgent = overHttps ? tunnel.httpOverHttps : tunnel.httpOverHttp;
            }
            agent = tunnelAgent(agentOptions);
            this._proxyAgent = agent;
        }
        // if reusing agent across request and tunneling agent isn't assigned create a new agent
        if (this._keepAlive && !agent) {
            const options = { keepAlive: this._keepAlive, maxSockets: maxSockets };
            agent = usingSsl ? new https.Agent(options) : new http.Agent(options);
            this._agent = agent;
        }
        // if not using private agent and tunnel agent isn't setup then use global agent
        if (!agent) {
            agent = usingSsl ? https.globalAgent : http.globalAgent;
        }
        if (usingSsl && this._ignoreSslError) {
            // we don't want to set NODE_TLS_REJECT_UNAUTHORIZED=0 since that will affect request for entire process
            // http.RequestOptions doesn't expose a way to modify RequestOptions.agent.options
            // we have to cast it to any and change it directly
            agent.options = Object.assign(agent.options || {}, {
                rejectUnauthorized: false
            });
        }
        return agent;
    }
    _performExponentialBackoff(retryNumber) {
        retryNumber = Math.min(ExponentialBackoffCeiling, retryNumber);
        const ms = ExponentialBackoffTimeSlice * Math.pow(2, retryNumber);
        return new Promise(resolve => setTimeout(() => resolve(), ms));
    }
    static dateTimeDeserializer(key, value) {
        if (typeof value === 'string') {
            let a = new Date(value);
            if (!isNaN(a.valueOf())) {
                return a;
            }
        }
        return value;
    }
    async _processResponse(res, options) {
        return new Promise(async (resolve, reject) => {
            const statusCode = res.message.statusCode;
            const response = {
                statusCode: statusCode,
                result: null,
                headers: {}
            };
            // not found leads to null obj returned
            if (statusCode == HttpCodes.NotFound) {
                resolve(response);
            }
            let obj;
            let contents;
            // get the result from the body
            try {
                contents = await res.readBody();
                if (contents && contents.length > 0) {
                    if (options && options.deserializeDates) {
                        obj = JSON.parse(contents, HttpClient.dateTimeDeserializer);
                    }
                    else {
                        obj = JSON.parse(contents);
                    }
                    response.result = obj;
                }
                response.headers = res.message.headers;
            }
            catch (err) {
                // Invalid resource (contents not json);  leaving result obj null
            }
            // note that 3xx redirects are handled by the http layer.
            if (statusCode > 299) {
                let msg;
                // if exception/error in body, attempt to get better error
                if (obj && obj.message) {
                    msg = obj.message;
                }
                else if (contents && contents.length > 0) {
                    // it may be the case that the exception is in the body message as string
                    msg = contents;
                }
                else {
                    msg = 'Failed request: (' + statusCode + ')';
                }
                let err = new Error(msg);
                // attach statusCode and body obj (if available) to the error object
                err['statusCode'] = statusCode;
                if (response.result) {
                    err['result'] = response.result;
                }
                reject(err);
            }
            else {
                resolve(response);
            }
        });
    }
}
exports.HttpClient = HttpClient;


/***/ }),

/***/ 6443:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
const url = __webpack_require__(8835);
function getProxyUrl(reqUrl) {
    let usingSsl = reqUrl.protocol === 'https:';
    let proxyUrl;
    if (checkBypass(reqUrl)) {
        return proxyUrl;
    }
    let proxyVar;
    if (usingSsl) {
        proxyVar = process.env['https_proxy'] || process.env['HTTPS_PROXY'];
    }
    else {
        proxyVar = process.env['http_proxy'] || process.env['HTTP_PROXY'];
    }
    if (proxyVar) {
        proxyUrl = url.parse(proxyVar);
    }
    return proxyUrl;
}
exports.getProxyUrl = getProxyUrl;
function checkBypass(reqUrl) {
    if (!reqUrl.hostname) {
        return false;
    }
    let noProxy = process.env['no_proxy'] || process.env['NO_PROXY'] || '';
    if (!noProxy) {
        return false;
    }
    // Determine the request port
    let reqPort;
    if (reqUrl.port) {
        reqPort = Number(reqUrl.port);
    }
    else if (reqUrl.protocol === 'http:') {
        reqPort = 80;
    }
    else if (reqUrl.protocol === 'https:') {
        reqPort = 443;
    }
    // Format the request hostname and hostname with port
    let upperReqHosts = [reqUrl.hostname.toUpperCase()];
    if (typeof reqPort === 'number') {
        upperReqHosts.push(`${upperReqHosts[0]}:${reqPort}`);
    }
    // Compare request host against noproxy
    for (let upperNoProxyItem of noProxy
        .split(',')
        .map(x => x.trim().toUpperCase())
        .filter(x => x)) {
        if (upperReqHosts.some(x => x === upperNoProxyItem)) {
            return true;
        }
    }
    return false;
}
exports.checkBypass = checkBypass;


/***/ }),

/***/ 334:
/***/ ((__unused_webpack_module, exports) => {

"use strict";


Object.defineProperty(exports, "__esModule", ({ value: true }));

async function auth(token) {
  const tokenType = token.split(/\./).length === 3 ? "app" : /^v\d+\./.test(token) ? "installation" : "oauth";
  return {
    type: "token",
    token: token,
    tokenType
  };
}

/**
 * Prefix token for usage in the Authorization header
 *
 * @param token OAuth token or JSON Web Token
 */
function withAuthorizationPrefix(token) {
  if (token.split(/\./).length === 3) {
    return `bearer ${token}`;
  }

  return `token ${token}`;
}

async function hook(token, request, route, parameters) {
  const endpoint = request.endpoint.merge(route, parameters);
  endpoint.headers.authorization = withAuthorizationPrefix(token);
  return request(endpoint);
}

const createTokenAuth = function createTokenAuth(token) {
  if (!token) {
    throw new Error("[@octokit/auth-token] No token passed to createTokenAuth");
  }

  if (typeof token !== "string") {
    throw new Error("[@octokit/auth-token] Token passed to createTokenAuth is not a string");
  }

  token = token.replace(/^(token|bearer) +/i, "");
  return Object.assign(auth.bind(null, token), {
    hook: hook.bind(null, token)
  });
};

exports.createTokenAuth = createTokenAuth;
//# sourceMappingURL=index.js.map


/***/ }),

/***/ 6762:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";


Object.defineProperty(exports, "__esModule", ({ value: true }));

var universalUserAgent = __webpack_require__(5030);
var beforeAfterHook = __webpack_require__(3682);
var request = __webpack_require__(6234);
var graphql = __webpack_require__(8467);
var authToken = __webpack_require__(334);

function _defineProperty(obj, key, value) {
  if (key in obj) {
    Object.defineProperty(obj, key, {
      value: value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  } else {
    obj[key] = value;
  }

  return obj;
}

function ownKeys(object, enumerableOnly) {
  var keys = Object.keys(object);

  if (Object.getOwnPropertySymbols) {
    var symbols = Object.getOwnPropertySymbols(object);
    if (enumerableOnly) symbols = symbols.filter(function (sym) {
      return Object.getOwnPropertyDescriptor(object, sym).enumerable;
    });
    keys.push.apply(keys, symbols);
  }

  return keys;
}

function _objectSpread2(target) {
  for (var i = 1; i < arguments.length; i++) {
    var source = arguments[i] != null ? arguments[i] : {};

    if (i % 2) {
      ownKeys(Object(source), true).forEach(function (key) {
        _defineProperty(target, key, source[key]);
      });
    } else if (Object.getOwnPropertyDescriptors) {
      Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
    } else {
      ownKeys(Object(source)).forEach(function (key) {
        Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
      });
    }
  }

  return target;
}

const VERSION = "3.1.2";

class Octokit {
  constructor(options = {}) {
    const hook = new beforeAfterHook.Collection();
    const requestDefaults = {
      baseUrl: request.request.endpoint.DEFAULTS.baseUrl,
      headers: {},
      request: Object.assign({}, options.request, {
        hook: hook.bind(null, "request")
      }),
      mediaType: {
        previews: [],
        format: ""
      }
    }; // prepend default user agent with `options.userAgent` if set

    requestDefaults.headers["user-agent"] = [options.userAgent, `octokit-core.js/${VERSION} ${universalUserAgent.getUserAgent()}`].filter(Boolean).join(" ");

    if (options.baseUrl) {
      requestDefaults.baseUrl = options.baseUrl;
    }

    if (options.previews) {
      requestDefaults.mediaType.previews = options.previews;
    }

    if (options.timeZone) {
      requestDefaults.headers["time-zone"] = options.timeZone;
    }

    this.request = request.request.defaults(requestDefaults);
    this.graphql = graphql.withCustomRequest(this.request).defaults(_objectSpread2(_objectSpread2({}, requestDefaults), {}, {
      baseUrl: requestDefaults.baseUrl.replace(/\/api\/v3$/, "/api")
    }));
    this.log = Object.assign({
      debug: () => {},
      info: () => {},
      warn: console.warn.bind(console),
      error: console.error.bind(console)
    }, options.log);
    this.hook = hook; // (1) If neither `options.authStrategy` nor `options.auth` are set, the `octokit` instance
    //     is unauthenticated. The `this.auth()` method is a no-op and no request hook is registred.
    // (2) If only `options.auth` is set, use the default token authentication strategy.
    // (3) If `options.authStrategy` is set then use it and pass in `options.auth`. Always pass own request as many strategies accept a custom request instance.
    // TODO: type `options.auth` based on `options.authStrategy`.

    if (!options.authStrategy) {
      if (!options.auth) {
        // (1)
        this.auth = async () => ({
          type: "unauthenticated"
        });
      } else {
        // (2)
        const auth = authToken.createTokenAuth(options.auth); // @ts-ignore  ??\_(???)_/??

        hook.wrap("request", auth.hook);
        this.auth = auth;
      }
    } else {
      const auth = options.authStrategy(Object.assign({
        request: this.request
      }, options.auth)); // @ts-ignore  ??\_(???)_/??

      hook.wrap("request", auth.hook);
      this.auth = auth;
    } // apply plugins
    // https://stackoverflow.com/a/16345172


    const classConstructor = this.constructor;
    classConstructor.plugins.forEach(plugin => {
      Object.assign(this, plugin(this, options));
    });
  }

  static defaults(defaults) {
    const OctokitWithDefaults = class extends this {
      constructor(...args) {
        const options = args[0] || {};

        if (typeof defaults === "function") {
          super(defaults(options));
          return;
        }

        super(Object.assign({}, defaults, options, options.userAgent && defaults.userAgent ? {
          userAgent: `${options.userAgent} ${defaults.userAgent}`
        } : null));
      }

    };
    return OctokitWithDefaults;
  }
  /**
   * Attach a plugin (or many) to your Octokit instance.
   *
   * @example
   * const API = Octokit.plugin(plugin1, plugin2, plugin3, ...)
   */


  static plugin(...newPlugins) {
    var _a;

    const currentPlugins = this.plugins;
    const NewOctokit = (_a = class extends this {}, _a.plugins = currentPlugins.concat(newPlugins.filter(plugin => !currentPlugins.includes(plugin))), _a);
    return NewOctokit;
  }

}
Octokit.VERSION = VERSION;
Octokit.plugins = [];

exports.Octokit = Octokit;
//# sourceMappingURL=index.js.map


/***/ }),

/***/ 9440:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";


Object.defineProperty(exports, "__esModule", ({ value: true }));

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var isPlainObject = _interopDefault(__webpack_require__(4038));
var universalUserAgent = __webpack_require__(5030);

function lowercaseKeys(object) {
  if (!object) {
    return {};
  }

  return Object.keys(object).reduce((newObj, key) => {
    newObj[key.toLowerCase()] = object[key];
    return newObj;
  }, {});
}

function mergeDeep(defaults, options) {
  const result = Object.assign({}, defaults);
  Object.keys(options).forEach(key => {
    if (isPlainObject(options[key])) {
      if (!(key in defaults)) Object.assign(result, {
        [key]: options[key]
      });else result[key] = mergeDeep(defaults[key], options[key]);
    } else {
      Object.assign(result, {
        [key]: options[key]
      });
    }
  });
  return result;
}

function merge(defaults, route, options) {
  if (typeof route === "string") {
    let [method, url] = route.split(" ");
    options = Object.assign(url ? {
      method,
      url
    } : {
      url: method
    }, options);
  } else {
    options = Object.assign({}, route);
  } // lowercase header names before merging with defaults to avoid duplicates


  options.headers = lowercaseKeys(options.headers);
  const mergedOptions = mergeDeep(defaults || {}, options); // mediaType.previews arrays are merged, instead of overwritten

  if (defaults && defaults.mediaType.previews.length) {
    mergedOptions.mediaType.previews = defaults.mediaType.previews.filter(preview => !mergedOptions.mediaType.previews.includes(preview)).concat(mergedOptions.mediaType.previews);
  }

  mergedOptions.mediaType.previews = mergedOptions.mediaType.previews.map(preview => preview.replace(/-preview/, ""));
  return mergedOptions;
}

function addQueryParameters(url, parameters) {
  const separator = /\?/.test(url) ? "&" : "?";
  const names = Object.keys(parameters);

  if (names.length === 0) {
    return url;
  }

  return url + separator + names.map(name => {
    if (name === "q") {
      return "q=" + parameters.q.split("+").map(encodeURIComponent).join("+");
    }

    return `${name}=${encodeURIComponent(parameters[name])}`;
  }).join("&");
}

const urlVariableRegex = /\{[^}]+\}/g;

function removeNonChars(variableName) {
  return variableName.replace(/^\W+|\W+$/g, "").split(/,/);
}

function extractUrlVariableNames(url) {
  const matches = url.match(urlVariableRegex);

  if (!matches) {
    return [];
  }

  return matches.map(removeNonChars).reduce((a, b) => a.concat(b), []);
}

function omit(object, keysToOmit) {
  return Object.keys(object).filter(option => !keysToOmit.includes(option)).reduce((obj, key) => {
    obj[key] = object[key];
    return obj;
  }, {});
}

// Based on https://github.com/bramstein/url-template, licensed under BSD
// TODO: create separate package.
//
// Copyright (c) 2012-2014, Bram Stein
// All rights reserved.
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions
// are met:
//  1. Redistributions of source code must retain the above copyright
//     notice, this list of conditions and the following disclaimer.
//  2. Redistributions in binary form must reproduce the above copyright
//     notice, this list of conditions and the following disclaimer in the
//     documentation and/or other materials provided with the distribution.
//  3. The name of the author may not be used to endorse or promote products
//     derived from this software without specific prior written permission.
// THIS SOFTWARE IS PROVIDED BY THE AUTHOR "AS IS" AND ANY EXPRESS OR IMPLIED
// WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
// MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO
// EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT,
// INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
// BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
// DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
// OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
// NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
// EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

/* istanbul ignore file */
function encodeReserved(str) {
  return str.split(/(%[0-9A-Fa-f]{2})/g).map(function (part) {
    if (!/%[0-9A-Fa-f]/.test(part)) {
      part = encodeURI(part).replace(/%5B/g, "[").replace(/%5D/g, "]");
    }

    return part;
  }).join("");
}

function encodeUnreserved(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, function (c) {
    return "%" + c.charCodeAt(0).toString(16).toUpperCase();
  });
}

function encodeValue(operator, value, key) {
  value = operator === "+" || operator === "#" ? encodeReserved(value) : encodeUnreserved(value);

  if (key) {
    return encodeUnreserved(key) + "=" + value;
  } else {
    return value;
  }
}

function isDefined(value) {
  return value !== undefined && value !== null;
}

function isKeyOperator(operator) {
  return operator === ";" || operator === "&" || operator === "?";
}

function getValues(context, operator, key, modifier) {
  var value = context[key],
      result = [];

  if (isDefined(value) && value !== "") {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      value = value.toString();

      if (modifier && modifier !== "*") {
        value = value.substring(0, parseInt(modifier, 10));
      }

      result.push(encodeValue(operator, value, isKeyOperator(operator) ? key : ""));
    } else {
      if (modifier === "*") {
        if (Array.isArray(value)) {
          value.filter(isDefined).forEach(function (value) {
            result.push(encodeValue(operator, value, isKeyOperator(operator) ? key : ""));
          });
        } else {
          Object.keys(value).forEach(function (k) {
            if (isDefined(value[k])) {
              result.push(encodeValue(operator, value[k], k));
            }
          });
        }
      } else {
        const tmp = [];

        if (Array.isArray(value)) {
          value.filter(isDefined).forEach(function (value) {
            tmp.push(encodeValue(operator, value));
          });
        } else {
          Object.keys(value).forEach(function (k) {
            if (isDefined(value[k])) {
              tmp.push(encodeUnreserved(k));
              tmp.push(encodeValue(operator, value[k].toString()));
            }
          });
        }

        if (isKeyOperator(operator)) {
          result.push(encodeUnreserved(key) + "=" + tmp.join(","));
        } else if (tmp.length !== 0) {
          result.push(tmp.join(","));
        }
      }
    }
  } else {
    if (operator === ";") {
      if (isDefined(value)) {
        result.push(encodeUnreserved(key));
      }
    } else if (value === "" && (operator === "&" || operator === "?")) {
      result.push(encodeUnreserved(key) + "=");
    } else if (value === "") {
      result.push("");
    }
  }

  return result;
}

function parseUrl(template) {
  return {
    expand: expand.bind(null, template)
  };
}

function expand(template, context) {
  var operators = ["+", "#", ".", "/", ";", "?", "&"];
  return template.replace(/\{([^\{\}]+)\}|([^\{\}]+)/g, function (_, expression, literal) {
    if (expression) {
      let operator = "";
      const values = [];

      if (operators.indexOf(expression.charAt(0)) !== -1) {
        operator = expression.charAt(0);
        expression = expression.substr(1);
      }

      expression.split(/,/g).forEach(function (variable) {
        var tmp = /([^:\*]*)(?::(\d+)|(\*))?/.exec(variable);
        values.push(getValues(context, operator, tmp[1], tmp[2] || tmp[3]));
      });

      if (operator && operator !== "+") {
        var separator = ",";

        if (operator === "?") {
          separator = "&";
        } else if (operator !== "#") {
          separator = operator;
        }

        return (values.length !== 0 ? operator : "") + values.join(separator);
      } else {
        return values.join(",");
      }
    } else {
      return encodeReserved(literal);
    }
  });
}

function parse(options) {
  // https://fetch.spec.whatwg.org/#methods
  let method = options.method.toUpperCase(); // replace :varname with {varname} to make it RFC 6570 compatible

  let url = (options.url || "/").replace(/:([a-z]\w+)/g, "{+$1}");
  let headers = Object.assign({}, options.headers);
  let body;
  let parameters = omit(options, ["method", "baseUrl", "url", "headers", "request", "mediaType"]); // extract variable names from URL to calculate remaining variables later

  const urlVariableNames = extractUrlVariableNames(url);
  url = parseUrl(url).expand(parameters);

  if (!/^http/.test(url)) {
    url = options.baseUrl + url;
  }

  const omittedParameters = Object.keys(options).filter(option => urlVariableNames.includes(option)).concat("baseUrl");
  const remainingParameters = omit(parameters, omittedParameters);
  const isBinaryRequset = /application\/octet-stream/i.test(headers.accept);

  if (!isBinaryRequset) {
    if (options.mediaType.format) {
      // e.g. application/vnd.github.v3+json => application/vnd.github.v3.raw
      headers.accept = headers.accept.split(/,/).map(preview => preview.replace(/application\/vnd(\.\w+)(\.v3)?(\.\w+)?(\+json)?$/, `application/vnd$1$2.${options.mediaType.format}`)).join(",");
    }

    if (options.mediaType.previews.length) {
      const previewsFromAcceptHeader = headers.accept.match(/[\w-]+(?=-preview)/g) || [];
      headers.accept = previewsFromAcceptHeader.concat(options.mediaType.previews).map(preview => {
        const format = options.mediaType.format ? `.${options.mediaType.format}` : "+json";
        return `application/vnd.github.${preview}-preview${format}`;
      }).join(",");
    }
  } // for GET/HEAD requests, set URL query parameters from remaining parameters
  // for PATCH/POST/PUT/DELETE requests, set request body from remaining parameters


  if (["GET", "HEAD"].includes(method)) {
    url = addQueryParameters(url, remainingParameters);
  } else {
    if ("data" in remainingParameters) {
      body = remainingParameters.data;
    } else {
      if (Object.keys(remainingParameters).length) {
        body = remainingParameters;
      } else {
        headers["content-length"] = 0;
      }
    }
  } // default content-type for JSON if body is set


  if (!headers["content-type"] && typeof body !== "undefined") {
    headers["content-type"] = "application/json; charset=utf-8";
  } // GitHub expects 'content-length: 0' header for PUT/PATCH requests without body.
  // fetch does not allow to set `content-length` header, but we can set body to an empty string


  if (["PATCH", "PUT"].includes(method) && typeof body === "undefined") {
    body = "";
  } // Only return body/request keys if present


  return Object.assign({
    method,
    url,
    headers
  }, typeof body !== "undefined" ? {
    body
  } : null, options.request ? {
    request: options.request
  } : null);
}

function endpointWithDefaults(defaults, route, options) {
  return parse(merge(defaults, route, options));
}

function withDefaults(oldDefaults, newDefaults) {
  const DEFAULTS = merge(oldDefaults, newDefaults);
  const endpoint = endpointWithDefaults.bind(null, DEFAULTS);
  return Object.assign(endpoint, {
    DEFAULTS,
    defaults: withDefaults.bind(null, DEFAULTS),
    merge: merge.bind(null, DEFAULTS),
    parse
  });
}

const VERSION = "6.0.5";

const userAgent = `octokit-endpoint.js/${VERSION} ${universalUserAgent.getUserAgent()}`; // DEFAULTS has all properties set that EndpointOptions has, except url.
// So we use RequestParameters and add method as additional required property.

const DEFAULTS = {
  method: "GET",
  baseUrl: "https://api.github.com",
  headers: {
    accept: "application/vnd.github.v3+json",
    "user-agent": userAgent
  },
  mediaType: {
    format: "",
    previews: []
  }
};

const endpoint = withDefaults(null, DEFAULTS);

exports.endpoint = endpoint;
//# sourceMappingURL=index.js.map


/***/ }),

/***/ 4038:
/***/ ((module) => {

"use strict";


/*!
 * is-plain-object <https://github.com/jonschlinkert/is-plain-object>
 *
 * Copyright (c) 2014-2017, Jon Schlinkert.
 * Released under the MIT License.
 */

function isObject(o) {
  return Object.prototype.toString.call(o) === '[object Object]';
}

function isPlainObject(o) {
  var ctor,prot;

  if (isObject(o) === false) return false;

  // If has modified constructor
  ctor = o.constructor;
  if (ctor === undefined) return true;

  // If has modified prototype
  prot = ctor.prototype;
  if (isObject(prot) === false) return false;

  // If constructor does not have an Object-specific method
  if (prot.hasOwnProperty('isPrototypeOf') === false) {
    return false;
  }

  // Most likely a plain Object
  return true;
}

module.exports = isPlainObject;


/***/ }),

/***/ 8467:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";


Object.defineProperty(exports, "__esModule", ({ value: true }));

var request = __webpack_require__(6234);
var universalUserAgent = __webpack_require__(5030);

const VERSION = "4.5.4";

class GraphqlError extends Error {
  constructor(request, response) {
    const message = response.data.errors[0].message;
    super(message);
    Object.assign(this, response.data);
    Object.assign(this, {
      headers: response.headers
    });
    this.name = "GraphqlError";
    this.request = request; // Maintains proper stack trace (only available on V8)

    /* istanbul ignore next */

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

}

const NON_VARIABLE_OPTIONS = ["method", "baseUrl", "url", "headers", "request", "query", "mediaType"];
function graphql(request, query, options) {
  options = typeof query === "string" ? options = Object.assign({
    query
  }, options) : options = query;
  const requestOptions = Object.keys(options).reduce((result, key) => {
    if (NON_VARIABLE_OPTIONS.includes(key)) {
      result[key] = options[key];
      return result;
    }

    if (!result.variables) {
      result.variables = {};
    }

    result.variables[key] = options[key];
    return result;
  }, {});
  return request(requestOptions).then(response => {
    if (response.data.errors) {
      const headers = {};

      for (const key of Object.keys(response.headers)) {
        headers[key] = response.headers[key];
      }

      throw new GraphqlError(requestOptions, {
        headers,
        data: response.data
      });
    }

    return response.data.data;
  });
}

function withDefaults(request$1, newDefaults) {
  const newRequest = request$1.defaults(newDefaults);

  const newApi = (query, options) => {
    return graphql(newRequest, query, options);
  };

  return Object.assign(newApi, {
    defaults: withDefaults.bind(null, newRequest),
    endpoint: request.request.endpoint
  });
}

const graphql$1 = withDefaults(request.request, {
  headers: {
    "user-agent": `octokit-graphql.js/${VERSION} ${universalUserAgent.getUserAgent()}`
  },
  method: "POST",
  url: "/graphql"
});
function withCustomRequest(customRequest) {
  return withDefaults(customRequest, {
    method: "POST",
    url: "/graphql"
  });
}

exports.graphql = graphql$1;
exports.withCustomRequest = withCustomRequest;
//# sourceMappingURL=index.js.map


/***/ }),

/***/ 4193:
/***/ ((__unused_webpack_module, exports) => {

"use strict";


Object.defineProperty(exports, "__esModule", ({ value: true }));

const VERSION = "2.3.1";

/**
 * Some ???list??? response that can be paginated have a different response structure
 *
 * They have a `total_count` key in the response (search also has `incomplete_results`,
 * /installation/repositories also has `repository_selection`), as well as a key with
 * the list of the items which name varies from endpoint to endpoint.
 *
 * Octokit normalizes these responses so that paginated results are always returned following
 * the same structure. One challenge is that if the list response has only one page, no Link
 * header is provided, so this header alone is not sufficient to check wether a response is
 * paginated or not.
 *
 * We check if a "total_count" key is present in the response data, but also make sure that
 * a "url" property is not, as the "Get the combined status for a specific ref" endpoint would
 * otherwise match: https://developer.github.com/v3/repos/statuses/#get-the-combined-status-for-a-specific-ref
 */
function normalizePaginatedListResponse(response) {
  const responseNeedsNormalization = "total_count" in response.data && !("url" in response.data);
  if (!responseNeedsNormalization) return response; // keep the additional properties intact as there is currently no other way
  // to retrieve the same information.

  const incompleteResults = response.data.incomplete_results;
  const repositorySelection = response.data.repository_selection;
  const totalCount = response.data.total_count;
  delete response.data.incomplete_results;
  delete response.data.repository_selection;
  delete response.data.total_count;
  const namespaceKey = Object.keys(response.data)[0];
  const data = response.data[namespaceKey];
  response.data = data;

  if (typeof incompleteResults !== "undefined") {
    response.data.incomplete_results = incompleteResults;
  }

  if (typeof repositorySelection !== "undefined") {
    response.data.repository_selection = repositorySelection;
  }

  response.data.total_count = totalCount;
  return response;
}

function iterator(octokit, route, parameters) {
  const options = typeof route === "function" ? route.endpoint(parameters) : octokit.request.endpoint(route, parameters);
  const requestMethod = typeof route === "function" ? route : octokit.request;
  const method = options.method;
  const headers = options.headers;
  let url = options.url;
  return {
    [Symbol.asyncIterator]: () => ({
      next() {
        if (!url) {
          return Promise.resolve({
            done: true
          });
        }

        return requestMethod({
          method,
          url,
          headers
        }).then(normalizePaginatedListResponse).then(response => {
          // `response.headers.link` format:
          // '<https://api.github.com/users/aseemk/followers?page=2>; rel="next", <https://api.github.com/users/aseemk/followers?page=2>; rel="last"'
          // sets `url` to undefined if "next" URL is not present or `link` header is not set
          url = ((response.headers.link || "").match(/<([^>]+)>;\s*rel="next"/) || [])[1];
          return {
            value: response
          };
        });
      }

    })
  };
}

function paginate(octokit, route, parameters, mapFn) {
  if (typeof parameters === "function") {
    mapFn = parameters;
    parameters = undefined;
  }

  return gather(octokit, [], iterator(octokit, route, parameters)[Symbol.asyncIterator](), mapFn);
}

function gather(octokit, results, iterator, mapFn) {
  return iterator.next().then(result => {
    if (result.done) {
      return results;
    }

    let earlyExit = false;

    function done() {
      earlyExit = true;
    }

    results = results.concat(mapFn ? mapFn(result.value, done) : result.value.data);

    if (earlyExit) {
      return results;
    }

    return gather(octokit, results, iterator, mapFn);
  });
}

/**
 * @param octokit Octokit instance
 * @param options Options passed to Octokit constructor
 */

function paginateRest(octokit) {
  return {
    paginate: Object.assign(paginate.bind(null, octokit), {
      iterator: iterator.bind(null, octokit)
    })
  };
}
paginateRest.VERSION = VERSION;

exports.paginateRest = paginateRest;
//# sourceMappingURL=index.js.map


/***/ }),

/***/ 8883:
/***/ ((__unused_webpack_module, exports) => {

"use strict";


Object.defineProperty(exports, "__esModule", ({ value: true }));

const VERSION = "1.0.0";

/**
 * @param octokit Octokit instance
 * @param options Options passed to Octokit constructor
 */

function requestLog(octokit) {
  octokit.hook.wrap("request", (request, options) => {
    octokit.log.debug("request", options);
    const start = Date.now();
    const requestOptions = octokit.request.endpoint.parse(options);
    const path = requestOptions.url.replace(options.baseUrl, "");
    return request(options).then(response => {
      octokit.log.info(`${requestOptions.method} ${path} - ${response.status} in ${Date.now() - start}ms`);
      return response;
    }).catch(error => {
      octokit.log.info(`${requestOptions.method} ${path} - ${error.status} in ${Date.now() - start}ms`);
      throw error;
    });
  });
}
requestLog.VERSION = VERSION;

exports.requestLog = requestLog;
//# sourceMappingURL=index.js.map


/***/ }),

/***/ 3044:
/***/ ((__unused_webpack_module, exports) => {

"use strict";


Object.defineProperty(exports, "__esModule", ({ value: true }));

const Endpoints = {
  actions: {
    addSelectedRepoToOrgSecret: ["PUT /orgs/{org}/actions/secrets/{secret_name}/repositories/{repository_id}"],
    cancelWorkflowRun: ["POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel"],
    createOrUpdateOrgSecret: ["PUT /orgs/{org}/actions/secrets/{secret_name}"],
    createOrUpdateRepoSecret: ["PUT /repos/{owner}/{repo}/actions/secrets/{secret_name}"],
    createRegistrationTokenForOrg: ["POST /orgs/{org}/actions/runners/registration-token"],
    createRegistrationTokenForRepo: ["POST /repos/{owner}/{repo}/actions/runners/registration-token"],
    createRemoveTokenForOrg: ["POST /orgs/{org}/actions/runners/remove-token"],
    createRemoveTokenForRepo: ["POST /repos/{owner}/{repo}/actions/runners/remove-token"],
    createWorkflowDispatch: ["POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches"],
    deleteArtifact: ["DELETE /repos/{owner}/{repo}/actions/artifacts/{artifact_id}"],
    deleteOrgSecret: ["DELETE /orgs/{org}/actions/secrets/{secret_name}"],
    deleteRepoSecret: ["DELETE /repos/{owner}/{repo}/actions/secrets/{secret_name}"],
    deleteSelfHostedRunnerFromOrg: ["DELETE /orgs/{org}/actions/runners/{runner_id}"],
    deleteSelfHostedRunnerFromRepo: ["DELETE /repos/{owner}/{repo}/actions/runners/{runner_id}"],
    deleteWorkflowRun: ["DELETE /repos/{owner}/{repo}/actions/runs/{run_id}"],
    deleteWorkflowRunLogs: ["DELETE /repos/{owner}/{repo}/actions/runs/{run_id}/logs"],
    downloadArtifact: ["GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}"],
    downloadJobLogsForWorkflowRun: ["GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs"],
    downloadWorkflowRunLogs: ["GET /repos/{owner}/{repo}/actions/runs/{run_id}/logs"],
    getArtifact: ["GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}"],
    getJobForWorkflowRun: ["GET /repos/{owner}/{repo}/actions/jobs/{job_id}"],
    getOrgPublicKey: ["GET /orgs/{org}/actions/secrets/public-key"],
    getOrgSecret: ["GET /orgs/{org}/actions/secrets/{secret_name}"],
    getRepoPublicKey: ["GET /repos/{owner}/{repo}/actions/secrets/public-key"],
    getRepoSecret: ["GET /repos/{owner}/{repo}/actions/secrets/{secret_name}"],
    getSelfHostedRunnerForOrg: ["GET /orgs/{org}/actions/runners/{runner_id}"],
    getSelfHostedRunnerForRepo: ["GET /repos/{owner}/{repo}/actions/runners/{runner_id}"],
    getWorkflow: ["GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}"],
    getWorkflowRun: ["GET /repos/{owner}/{repo}/actions/runs/{run_id}"],
    getWorkflowRunUsage: ["GET /repos/{owner}/{repo}/actions/runs/{run_id}/timing"],
    getWorkflowUsage: ["GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/timing"],
    listArtifactsForRepo: ["GET /repos/{owner}/{repo}/actions/artifacts"],
    listJobsForWorkflowRun: ["GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs"],
    listOrgSecrets: ["GET /orgs/{org}/actions/secrets"],
    listRepoSecrets: ["GET /repos/{owner}/{repo}/actions/secrets"],
    listRepoWorkflows: ["GET /repos/{owner}/{repo}/actions/workflows"],
    listRunnerApplicationsForOrg: ["GET /orgs/{org}/actions/runners/downloads"],
    listRunnerApplicationsForRepo: ["GET /repos/{owner}/{repo}/actions/runners/downloads"],
    listSelectedReposForOrgSecret: ["GET /orgs/{org}/actions/secrets/{secret_name}/repositories"],
    listSelfHostedRunnersForOrg: ["GET /orgs/{org}/actions/runners"],
    listSelfHostedRunnersForRepo: ["GET /repos/{owner}/{repo}/actions/runners"],
    listWorkflowRunArtifacts: ["GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts"],
    listWorkflowRuns: ["GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs"],
    listWorkflowRunsForRepo: ["GET /repos/{owner}/{repo}/actions/runs"],
    reRunWorkflow: ["POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun"],
    removeSelectedRepoFromOrgSecret: ["DELETE /orgs/{org}/actions/secrets/{secret_name}/repositories/{repository_id}"],
    setSelectedReposForOrgSecret: ["PUT /orgs/{org}/actions/secrets/{secret_name}/repositories"]
  },
  activity: {
    checkRepoIsStarredByAuthenticatedUser: ["GET /user/starred/{owner}/{repo}"],
    deleteRepoSubscription: ["DELETE /repos/{owner}/{repo}/subscription"],
    deleteThreadSubscription: ["DELETE /notifications/threads/{thread_id}/subscription"],
    getFeeds: ["GET /feeds"],
    getRepoSubscription: ["GET /repos/{owner}/{repo}/subscription"],
    getThread: ["GET /notifications/threads/{thread_id}"],
    getThreadSubscriptionForAuthenticatedUser: ["GET /notifications/threads/{thread_id}/subscription"],
    listEventsForAuthenticatedUser: ["GET /users/{username}/events"],
    listNotificationsForAuthenticatedUser: ["GET /notifications"],
    listOrgEventsForAuthenticatedUser: ["GET /users/{username}/events/orgs/{org}"],
    listPublicEvents: ["GET /events"],
    listPublicEventsForRepoNetwork: ["GET /networks/{owner}/{repo}/events"],
    listPublicEventsForUser: ["GET /users/{username}/events/public"],
    listPublicOrgEvents: ["GET /orgs/{org}/events"],
    listReceivedEventsForUser: ["GET /users/{username}/received_events"],
    listReceivedPublicEventsForUser: ["GET /users/{username}/received_events/public"],
    listRepoEvents: ["GET /repos/{owner}/{repo}/events"],
    listRepoNotificationsForAuthenticatedUser: ["GET /repos/{owner}/{repo}/notifications"],
    listReposStarredByAuthenticatedUser: ["GET /user/starred"],
    listReposStarredByUser: ["GET /users/{username}/starred"],
    listReposWatchedByUser: ["GET /users/{username}/subscriptions"],
    listStargazersForRepo: ["GET /repos/{owner}/{repo}/stargazers"],
    listWatchedReposForAuthenticatedUser: ["GET /user/subscriptions"],
    listWatchersForRepo: ["GET /repos/{owner}/{repo}/subscribers"],
    markNotificationsAsRead: ["PUT /notifications"],
    markRepoNotificationsAsRead: ["PUT /repos/{owner}/{repo}/notifications"],
    markThreadAsRead: ["PATCH /notifications/threads/{thread_id}"],
    setRepoSubscription: ["PUT /repos/{owner}/{repo}/subscription"],
    setThreadSubscription: ["PUT /notifications/threads/{thread_id}/subscription"],
    starRepoForAuthenticatedUser: ["PUT /user/starred/{owner}/{repo}"],
    unstarRepoForAuthenticatedUser: ["DELETE /user/starred/{owner}/{repo}"]
  },
  apps: {
    addRepoToInstallation: ["PUT /user/installations/{installation_id}/repositories/{repository_id}", {
      mediaType: {
        previews: ["machine-man"]
      }
    }],
    checkToken: ["POST /applications/{client_id}/token"],
    createContentAttachment: ["POST /content_references/{content_reference_id}/attachments", {
      mediaType: {
        previews: ["corsair"]
      }
    }],
    createFromManifest: ["POST /app-manifests/{code}/conversions"],
    createInstallationAccessToken: ["POST /app/installations/{installation_id}/access_tokens", {
      mediaType: {
        previews: ["machine-man"]
      }
    }],
    deleteAuthorization: ["DELETE /applications/{client_id}/grant"],
    deleteInstallation: ["DELETE /app/installations/{installation_id}", {
      mediaType: {
        previews: ["machine-man"]
      }
    }],
    deleteToken: ["DELETE /applications/{client_id}/token"],
    getAuthenticated: ["GET /app", {
      mediaType: {
        previews: ["machine-man"]
      }
    }],
    getBySlug: ["GET /apps/{app_slug}", {
      mediaType: {
        previews: ["machine-man"]
      }
    }],
    getInstallation: ["GET /app/installations/{installation_id}", {
      mediaType: {
        previews: ["machine-man"]
      }
    }],
    getOrgInstallation: ["GET /orgs/{org}/installation", {
      mediaType: {
        previews: ["machine-man"]
      }
    }],
    getRepoInstallation: ["GET /repos/{owner}/{repo}/installation", {
      mediaType: {
        previews: ["machine-man"]
      }
    }],
    getSubscriptionPlanForAccount: ["GET /marketplace_listing/accounts/{account_id}"],
    getSubscriptionPlanForAccountStubbed: ["GET /marketplace_listing/stubbed/accounts/{account_id}"],
    getUserInstallation: ["GET /users/{username}/installation", {
      mediaType: {
        previews: ["machine-man"]
      }
    }],
    listAccountsForPlan: ["GET /marketplace_listing/plans/{plan_id}/accounts"],
    listAccountsForPlanStubbed: ["GET /marketplace_listing/stubbed/plans/{plan_id}/accounts"],
    listInstallationReposForAuthenticatedUser: ["GET /user/installations/{installation_id}/repositories", {
      mediaType: {
        previews: ["machine-man"]
      }
    }],
    listInstallations: ["GET /app/installations", {
      mediaType: {
        previews: ["machine-man"]
      }
    }],
    listInstallationsForAuthenticatedUser: ["GET /user/installations", {
      mediaType: {
        previews: ["machine-man"]
      }
    }],
    listPlans: ["GET /marketplace_listing/plans"],
    listPlansStubbed: ["GET /marketplace_listing/stubbed/plans"],
    listReposAccessibleToInstallation: ["GET /installation/repositories", {
      mediaType: {
        previews: ["machine-man"]
      }
    }],
    listSubscriptionsForAuthenticatedUser: ["GET /user/marketplace_purchases"],
    listSubscriptionsForAuthenticatedUserStubbed: ["GET /user/marketplace_purchases/stubbed"],
    removeRepoFromInstallation: ["DELETE /user/installations/{installation_id}/repositories/{repository_id}", {
      mediaType: {
        previews: ["machine-man"]
      }
    }],
    resetToken: ["PATCH /applications/{client_id}/token"],
    revokeInstallationAccessToken: ["DELETE /installation/token"],
    suspendInstallation: ["PUT /app/installations/{installation_id}/suspended"],
    unsuspendInstallation: ["DELETE /app/installations/{installation_id}/suspended"]
  },
  billing: {
    getGithubActionsBillingOrg: ["GET /orgs/{org}/settings/billing/actions"],
    getGithubActionsBillingUser: ["GET /users/{username}/settings/billing/actions"],
    getGithubPackagesBillingOrg: ["GET /orgs/{org}/settings/billing/packages"],
    getGithubPackagesBillingUser: ["GET /users/{username}/settings/billing/packages"],
    getSharedStorageBillingOrg: ["GET /orgs/{org}/settings/billing/shared-storage"],
    getSharedStorageBillingUser: ["GET /users/{username}/settings/billing/shared-storage"]
  },
  checks: {
    create: ["POST /repos/{owner}/{repo}/check-runs", {
      mediaType: {
        previews: ["antiope"]
      }
    }],
    createSuite: ["POST /repos/{owner}/{repo}/check-suites", {
      mediaType: {
        previews: ["antiope"]
      }
    }],
    get: ["GET /repos/{owner}/{repo}/check-runs/{check_run_id}", {
      mediaType: {
        previews: ["antiope"]
      }
    }],
    getSuite: ["GET /repos/{owner}/{repo}/check-suites/{check_suite_id}", {
      mediaType: {
        previews: ["antiope"]
      }
    }],
    listAnnotations: ["GET /repos/{owner}/{repo}/check-runs/{check_run_id}/annotations", {
      mediaType: {
        previews: ["antiope"]
      }
    }],
    listForRef: ["GET /repos/{owner}/{repo}/commits/{ref}/check-runs", {
      mediaType: {
        previews: ["antiope"]
      }
    }],
    listForSuite: ["GET /repos/{owner}/{repo}/check-suites/{check_suite_id}/check-runs", {
      mediaType: {
        previews: ["antiope"]
      }
    }],
    listSuitesForRef: ["GET /repos/{owner}/{repo}/commits/{ref}/check-suites", {
      mediaType: {
        previews: ["antiope"]
      }
    }],
    rerequestSuite: ["POST /repos/{owner}/{repo}/check-suites/{check_suite_id}/rerequest", {
      mediaType: {
        previews: ["antiope"]
      }
    }],
    setSuitesPreferences: ["PATCH /repos/{owner}/{repo}/check-suites/preferences", {
      mediaType: {
        previews: ["antiope"]
      }
    }],
    update: ["PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}", {
      mediaType: {
        previews: ["antiope"]
      }
    }]
  },
  codeScanning: {
    getAlert: ["GET /repos/{owner}/{repo}/code-scanning/alerts/{alert_id}"],
    listAlertsForRepo: ["GET /repos/{owner}/{repo}/code-scanning/alerts"]
  },
  codesOfConduct: {
    getAllCodesOfConduct: ["GET /codes_of_conduct", {
      mediaType: {
        previews: ["scarlet-witch"]
      }
    }],
    getConductCode: ["GET /codes_of_conduct/{key}", {
      mediaType: {
        previews: ["scarlet-witch"]
      }
    }],
    getForRepo: ["GET /repos/{owner}/{repo}/community/code_of_conduct", {
      mediaType: {
        previews: ["scarlet-witch"]
      }
    }]
  },
  emojis: {
    get: ["GET /emojis"]
  },
  gists: {
    checkIsStarred: ["GET /gists/{gist_id}/star"],
    create: ["POST /gists"],
    createComment: ["POST /gists/{gist_id}/comments"],
    delete: ["DELETE /gists/{gist_id}"],
    deleteComment: ["DELETE /gists/{gist_id}/comments/{comment_id}"],
    fork: ["POST /gists/{gist_id}/forks"],
    get: ["GET /gists/{gist_id}"],
    getComment: ["GET /gists/{gist_id}/comments/{comment_id}"],
    getRevision: ["GET /gists/{gist_id}/{sha}"],
    list: ["GET /gists"],
    listComments: ["GET /gists/{gist_id}/comments"],
    listCommits: ["GET /gists/{gist_id}/commits"],
    listForUser: ["GET /users/{username}/gists"],
    listForks: ["GET /gists/{gist_id}/forks"],
    listPublic: ["GET /gists/public"],
    listStarred: ["GET /gists/starred"],
    star: ["PUT /gists/{gist_id}/star"],
    unstar: ["DELETE /gists/{gist_id}/star"],
    update: ["PATCH /gists/{gist_id}"],
    updateComment: ["PATCH /gists/{gist_id}/comments/{comment_id}"]
  },
  git: {
    createBlob: ["POST /repos/{owner}/{repo}/git/blobs"],
    createCommit: ["POST /repos/{owner}/{repo}/git/commits"],
    createRef: ["POST /repos/{owner}/{repo}/git/refs"],
    createTag: ["POST /repos/{owner}/{repo}/git/tags"],
    createTree: ["POST /repos/{owner}/{repo}/git/trees"],
    deleteRef: ["DELETE /repos/{owner}/{repo}/git/refs/{ref}"],
    getBlob: ["GET /repos/{owner}/{repo}/git/blobs/{file_sha}"],
    getCommit: ["GET /repos/{owner}/{repo}/git/commits/{commit_sha}"],
    getRef: ["GET /repos/{owner}/{repo}/git/ref/{ref}"],
    getTag: ["GET /repos/{owner}/{repo}/git/tags/{tag_sha}"],
    getTree: ["GET /repos/{owner}/{repo}/git/trees/{tree_sha}"],
    listMatchingRefs: ["GET /repos/{owner}/{repo}/git/matching-refs/{ref}"],
    updateRef: ["PATCH /repos/{owner}/{repo}/git/refs/{ref}"]
  },
  gitignore: {
    getAllTemplates: ["GET /gitignore/templates"],
    getTemplate: ["GET /gitignore/templates/{name}"]
  },
  interactions: {
    getRestrictionsForOrg: ["GET /orgs/{org}/interaction-limits", {
      mediaType: {
        previews: ["sombra"]
      }
    }],
    getRestrictionsForRepo: ["GET /repos/{owner}/{repo}/interaction-limits", {
      mediaType: {
        previews: ["sombra"]
      }
    }],
    removeRestrictionsForOrg: ["DELETE /orgs/{org}/interaction-limits", {
      mediaType: {
        previews: ["sombra"]
      }
    }],
    removeRestrictionsForRepo: ["DELETE /repos/{owner}/{repo}/interaction-limits", {
      mediaType: {
        previews: ["sombra"]
      }
    }],
    setRestrictionsForOrg: ["PUT /orgs/{org}/interaction-limits", {
      mediaType: {
        previews: ["sombra"]
      }
    }],
    setRestrictionsForRepo: ["PUT /repos/{owner}/{repo}/interaction-limits", {
      mediaType: {
        previews: ["sombra"]
      }
    }]
  },
  issues: {
    addAssignees: ["POST /repos/{owner}/{repo}/issues/{issue_number}/assignees"],
    addLabels: ["POST /repos/{owner}/{repo}/issues/{issue_number}/labels"],
    checkUserCanBeAssigned: ["GET /repos/{owner}/{repo}/assignees/{assignee}"],
    create: ["POST /repos/{owner}/{repo}/issues"],
    createComment: ["POST /repos/{owner}/{repo}/issues/{issue_number}/comments"],
    createLabel: ["POST /repos/{owner}/{repo}/labels"],
    createMilestone: ["POST /repos/{owner}/{repo}/milestones"],
    deleteComment: ["DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}"],
    deleteLabel: ["DELETE /repos/{owner}/{repo}/labels/{name}"],
    deleteMilestone: ["DELETE /repos/{owner}/{repo}/milestones/{milestone_number}"],
    get: ["GET /repos/{owner}/{repo}/issues/{issue_number}"],
    getComment: ["GET /repos/{owner}/{repo}/issues/comments/{comment_id}"],
    getEvent: ["GET /repos/{owner}/{repo}/issues/events/{event_id}"],
    getLabel: ["GET /repos/{owner}/{repo}/labels/{name}"],
    getMilestone: ["GET /repos/{owner}/{repo}/milestones/{milestone_number}"],
    list: ["GET /issues"],
    listAssignees: ["GET /repos/{owner}/{repo}/assignees"],
    listComments: ["GET /repos/{owner}/{repo}/issues/{issue_number}/comments"],
    listCommentsForRepo: ["GET /repos/{owner}/{repo}/issues/comments"],
    listEvents: ["GET /repos/{owner}/{repo}/issues/{issue_number}/events"],
    listEventsForRepo: ["GET /repos/{owner}/{repo}/issues/events"],
    listEventsForTimeline: ["GET /repos/{owner}/{repo}/issues/{issue_number}/timeline", {
      mediaType: {
        previews: ["mockingbird"]
      }
    }],
    listForAuthenticatedUser: ["GET /user/issues"],
    listForOrg: ["GET /orgs/{org}/issues"],
    listForRepo: ["GET /repos/{owner}/{repo}/issues"],
    listLabelsForMilestone: ["GET /repos/{owner}/{repo}/milestones/{milestone_number}/labels"],
    listLabelsForRepo: ["GET /repos/{owner}/{repo}/labels"],
    listLabelsOnIssue: ["GET /repos/{owner}/{repo}/issues/{issue_number}/labels"],
    listMilestones: ["GET /repos/{owner}/{repo}/milestones"],
    lock: ["PUT /repos/{owner}/{repo}/issues/{issue_number}/lock"],
    removeAllLabels: ["DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels"],
    removeAssignees: ["DELETE /repos/{owner}/{repo}/issues/{issue_number}/assignees"],
    removeLabel: ["DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}"],
    setLabels: ["PUT /repos/{owner}/{repo}/issues/{issue_number}/labels"],
    unlock: ["DELETE /repos/{owner}/{repo}/issues/{issue_number}/lock"],
    update: ["PATCH /repos/{owner}/{repo}/issues/{issue_number}"],
    updateComment: ["PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}"],
    updateLabel: ["PATCH /repos/{owner}/{repo}/labels/{name}"],
    updateMilestone: ["PATCH /repos/{owner}/{repo}/milestones/{milestone_number}"]
  },
  licenses: {
    get: ["GET /licenses/{license}"],
    getAllCommonlyUsed: ["GET /licenses"],
    getForRepo: ["GET /repos/{owner}/{repo}/license"]
  },
  markdown: {
    render: ["POST /markdown"],
    renderRaw: ["POST /markdown/raw", {
      headers: {
        "content-type": "text/plain; charset=utf-8"
      }
    }]
  },
  meta: {
    get: ["GET /meta"]
  },
  migrations: {
    cancelImport: ["DELETE /repos/{owner}/{repo}/import"],
    deleteArchiveForAuthenticatedUser: ["DELETE /user/migrations/{migration_id}/archive", {
      mediaType: {
        previews: ["wyandotte"]
      }
    }],
    deleteArchiveForOrg: ["DELETE /orgs/{org}/migrations/{migration_id}/archive", {
      mediaType: {
        previews: ["wyandotte"]
      }
    }],
    downloadArchiveForOrg: ["GET /orgs/{org}/migrations/{migration_id}/archive", {
      mediaType: {
        previews: ["wyandotte"]
      }
    }],
    getArchiveForAuthenticatedUser: ["GET /user/migrations/{migration_id}/archive", {
      mediaType: {
        previews: ["wyandotte"]
      }
    }],
    getCommitAuthors: ["GET /repos/{owner}/{repo}/import/authors"],
    getImportStatus: ["GET /repos/{owner}/{repo}/import"],
    getLargeFiles: ["GET /repos/{owner}/{repo}/import/large_files"],
    getStatusForAuthenticatedUser: ["GET /user/migrations/{migration_id}", {
      mediaType: {
        previews: ["wyandotte"]
      }
    }],
    getStatusForOrg: ["GET /orgs/{org}/migrations/{migration_id}", {
      mediaType: {
        previews: ["wyandotte"]
      }
    }],
    listForAuthenticatedUser: ["GET /user/migrations", {
      mediaType: {
        previews: ["wyandotte"]
      }
    }],
    listForOrg: ["GET /orgs/{org}/migrations", {
      mediaType: {
        previews: ["wyandotte"]
      }
    }],
    listReposForOrg: ["GET /orgs/{org}/migrations/{migration_id}/repositories", {
      mediaType: {
        previews: ["wyandotte"]
      }
    }],
    listReposForUser: ["GET /user/migrations/{migration_id}/repositories", {
      mediaType: {
        previews: ["wyandotte"]
      }
    }],
    mapCommitAuthor: ["PATCH /repos/{owner}/{repo}/import/authors/{author_id}"],
    setLfsPreference: ["PATCH /repos/{owner}/{repo}/import/lfs"],
    startForAuthenticatedUser: ["POST /user/migrations"],
    startForOrg: ["POST /orgs/{org}/migrations"],
    startImport: ["PUT /repos/{owner}/{repo}/import"],
    unlockRepoForAuthenticatedUser: ["DELETE /user/migrations/{migration_id}/repos/{repo_name}/lock", {
      mediaType: {
        previews: ["wyandotte"]
      }
    }],
    unlockRepoForOrg: ["DELETE /orgs/{org}/migrations/{migration_id}/repos/{repo_name}/lock", {
      mediaType: {
        previews: ["wyandotte"]
      }
    }],
    updateImport: ["PATCH /repos/{owner}/{repo}/import"]
  },
  orgs: {
    blockUser: ["PUT /orgs/{org}/blocks/{username}"],
    checkBlockedUser: ["GET /orgs/{org}/blocks/{username}"],
    checkMembershipForUser: ["GET /orgs/{org}/members/{username}"],
    checkPublicMembershipForUser: ["GET /orgs/{org}/public_members/{username}"],
    convertMemberToOutsideCollaborator: ["PUT /orgs/{org}/outside_collaborators/{username}"],
    createInvitation: ["POST /orgs/{org}/invitations"],
    createWebhook: ["POST /orgs/{org}/hooks"],
    deleteWebhook: ["DELETE /orgs/{org}/hooks/{hook_id}"],
    get: ["GET /orgs/{org}"],
    getMembershipForAuthenticatedUser: ["GET /user/memberships/orgs/{org}"],
    getMembershipForUser: ["GET /orgs/{org}/memberships/{username}"],
    getWebhook: ["GET /orgs/{org}/hooks/{hook_id}"],
    list: ["GET /organizations"],
    listAppInstallations: ["GET /orgs/{org}/installations", {
      mediaType: {
        previews: ["machine-man"]
      }
    }],
    listBlockedUsers: ["GET /orgs/{org}/blocks"],
    listForAuthenticatedUser: ["GET /user/orgs"],
    listForUser: ["GET /users/{username}/orgs"],
    listInvitationTeams: ["GET /orgs/{org}/invitations/{invitation_id}/teams"],
    listMembers: ["GET /orgs/{org}/members"],
    listMembershipsForAuthenticatedUser: ["GET /user/memberships/orgs"],
    listOutsideCollaborators: ["GET /orgs/{org}/outside_collaborators"],
    listPendingInvitations: ["GET /orgs/{org}/invitations"],
    listPublicMembers: ["GET /orgs/{org}/public_members"],
    listWebhooks: ["GET /orgs/{org}/hooks"],
    pingWebhook: ["POST /orgs/{org}/hooks/{hook_id}/pings"],
    removeMember: ["DELETE /orgs/{org}/members/{username}"],
    removeMembershipForUser: ["DELETE /orgs/{org}/memberships/{username}"],
    removeOutsideCollaborator: ["DELETE /orgs/{org}/outside_collaborators/{username}"],
    removePublicMembershipForAuthenticatedUser: ["DELETE /orgs/{org}/public_members/{username}"],
    setMembershipForUser: ["PUT /orgs/{org}/memberships/{username}"],
    setPublicMembershipForAuthenticatedUser: ["PUT /orgs/{org}/public_members/{username}"],
    unblockUser: ["DELETE /orgs/{org}/blocks/{username}"],
    update: ["PATCH /orgs/{org}"],
    updateMembershipForAuthenticatedUser: ["PATCH /user/memberships/orgs/{org}"],
    updateWebhook: ["PATCH /orgs/{org}/hooks/{hook_id}"]
  },
  projects: {
    addCollaborator: ["PUT /projects/{project_id}/collaborators/{username}", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    createCard: ["POST /projects/columns/{column_id}/cards", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    createColumn: ["POST /projects/{project_id}/columns", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    createForAuthenticatedUser: ["POST /user/projects", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    createForOrg: ["POST /orgs/{org}/projects", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    createForRepo: ["POST /repos/{owner}/{repo}/projects", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    delete: ["DELETE /projects/{project_id}", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    deleteCard: ["DELETE /projects/columns/cards/{card_id}", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    deleteColumn: ["DELETE /projects/columns/{column_id}", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    get: ["GET /projects/{project_id}", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    getCard: ["GET /projects/columns/cards/{card_id}", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    getColumn: ["GET /projects/columns/{column_id}", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    getPermissionForUser: ["GET /projects/{project_id}/collaborators/{username}/permission", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    listCards: ["GET /projects/columns/{column_id}/cards", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    listCollaborators: ["GET /projects/{project_id}/collaborators", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    listColumns: ["GET /projects/{project_id}/columns", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    listForOrg: ["GET /orgs/{org}/projects", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    listForRepo: ["GET /repos/{owner}/{repo}/projects", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    listForUser: ["GET /users/{username}/projects", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    moveCard: ["POST /projects/columns/cards/{card_id}/moves", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    moveColumn: ["POST /projects/columns/{column_id}/moves", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    removeCollaborator: ["DELETE /projects/{project_id}/collaborators/{username}", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    update: ["PATCH /projects/{project_id}", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    updateCard: ["PATCH /projects/columns/cards/{card_id}", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    updateColumn: ["PATCH /projects/columns/{column_id}", {
      mediaType: {
        previews: ["inertia"]
      }
    }]
  },
  pulls: {
    checkIfMerged: ["GET /repos/{owner}/{repo}/pulls/{pull_number}/merge"],
    create: ["POST /repos/{owner}/{repo}/pulls"],
    createReplyForReviewComment: ["POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies"],
    createReview: ["POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews"],
    createReviewComment: ["POST /repos/{owner}/{repo}/pulls/{pull_number}/comments"],
    deletePendingReview: ["DELETE /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}"],
    deleteReviewComment: ["DELETE /repos/{owner}/{repo}/pulls/comments/{comment_id}"],
    dismissReview: ["PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/dismissals"],
    get: ["GET /repos/{owner}/{repo}/pulls/{pull_number}"],
    getReview: ["GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}"],
    getReviewComment: ["GET /repos/{owner}/{repo}/pulls/comments/{comment_id}"],
    list: ["GET /repos/{owner}/{repo}/pulls"],
    listCommentsForReview: ["GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/comments"],
    listCommits: ["GET /repos/{owner}/{repo}/pulls/{pull_number}/commits"],
    listFiles: ["GET /repos/{owner}/{repo}/pulls/{pull_number}/files"],
    listRequestedReviewers: ["GET /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers"],
    listReviewComments: ["GET /repos/{owner}/{repo}/pulls/{pull_number}/comments"],
    listReviewCommentsForRepo: ["GET /repos/{owner}/{repo}/pulls/comments"],
    listReviews: ["GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews"],
    merge: ["PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge"],
    removeRequestedReviewers: ["DELETE /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers"],
    requestReviewers: ["POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers"],
    submitReview: ["POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/events"],
    update: ["PATCH /repos/{owner}/{repo}/pulls/{pull_number}"],
    updateBranch: ["PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch", {
      mediaType: {
        previews: ["lydian"]
      }
    }],
    updateReview: ["PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}"],
    updateReviewComment: ["PATCH /repos/{owner}/{repo}/pulls/comments/{comment_id}"]
  },
  rateLimit: {
    get: ["GET /rate_limit"]
  },
  reactions: {
    createForCommitComment: ["POST /repos/{owner}/{repo}/comments/{comment_id}/reactions", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    createForIssue: ["POST /repos/{owner}/{repo}/issues/{issue_number}/reactions", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    createForIssueComment: ["POST /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    createForPullRequestReviewComment: ["POST /repos/{owner}/{repo}/pulls/comments/{comment_id}/reactions", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    createForTeamDiscussionCommentInOrg: ["POST /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/comments/{comment_number}/reactions", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    createForTeamDiscussionInOrg: ["POST /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/reactions", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    deleteForCommitComment: ["DELETE /repos/{owner}/{repo}/comments/{comment_id}/reactions/{reaction_id}", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    deleteForIssue: ["DELETE /repos/{owner}/{repo}/issues/{issue_number}/reactions/{reaction_id}", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    deleteForIssueComment: ["DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions/{reaction_id}", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    deleteForPullRequestComment: ["DELETE /repos/{owner}/{repo}/pulls/comments/{comment_id}/reactions/{reaction_id}", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    deleteForTeamDiscussion: ["DELETE /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/reactions/{reaction_id}", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    deleteForTeamDiscussionComment: ["DELETE /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/comments/{comment_number}/reactions/{reaction_id}", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    deleteLegacy: ["DELETE /reactions/{reaction_id}", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }, {
      deprecated: "octokit.reactions.deleteLegacy() is deprecated, see https://developer.github.com/v3/reactions/#delete-a-reaction-legacy"
    }],
    listForCommitComment: ["GET /repos/{owner}/{repo}/comments/{comment_id}/reactions", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    listForIssue: ["GET /repos/{owner}/{repo}/issues/{issue_number}/reactions", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    listForIssueComment: ["GET /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    listForPullRequestReviewComment: ["GET /repos/{owner}/{repo}/pulls/comments/{comment_id}/reactions", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    listForTeamDiscussionCommentInOrg: ["GET /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/comments/{comment_number}/reactions", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }],
    listForTeamDiscussionInOrg: ["GET /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/reactions", {
      mediaType: {
        previews: ["squirrel-girl"]
      }
    }]
  },
  repos: {
    acceptInvitation: ["PATCH /user/repository_invitations/{invitation_id}"],
    addAppAccessRestrictions: ["POST /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/apps", {}, {
      mapToData: "apps"
    }],
    addCollaborator: ["PUT /repos/{owner}/{repo}/collaborators/{username}"],
    addStatusCheckContexts: ["POST /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks/contexts", {}, {
      mapToData: "contexts"
    }],
    addTeamAccessRestrictions: ["POST /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/teams", {}, {
      mapToData: "teams"
    }],
    addUserAccessRestrictions: ["POST /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/users", {}, {
      mapToData: "users"
    }],
    checkCollaborator: ["GET /repos/{owner}/{repo}/collaborators/{username}"],
    checkVulnerabilityAlerts: ["GET /repos/{owner}/{repo}/vulnerability-alerts", {
      mediaType: {
        previews: ["dorian"]
      }
    }],
    compareCommits: ["GET /repos/{owner}/{repo}/compare/{base}...{head}"],
    createCommitComment: ["POST /repos/{owner}/{repo}/commits/{commit_sha}/comments"],
    createCommitSignatureProtection: ["POST /repos/{owner}/{repo}/branches/{branch}/protection/required_signatures", {
      mediaType: {
        previews: ["zzzax"]
      }
    }],
    createCommitStatus: ["POST /repos/{owner}/{repo}/statuses/{sha}"],
    createDeployKey: ["POST /repos/{owner}/{repo}/keys"],
    createDeployment: ["POST /repos/{owner}/{repo}/deployments"],
    createDeploymentStatus: ["POST /repos/{owner}/{repo}/deployments/{deployment_id}/statuses"],
    createDispatchEvent: ["POST /repos/{owner}/{repo}/dispatches"],
    createForAuthenticatedUser: ["POST /user/repos"],
    createFork: ["POST /repos/{owner}/{repo}/forks"],
    createInOrg: ["POST /orgs/{org}/repos"],
    createOrUpdateFileContents: ["PUT /repos/{owner}/{repo}/contents/{path}"],
    createPagesSite: ["POST /repos/{owner}/{repo}/pages", {
      mediaType: {
        previews: ["switcheroo"]
      }
    }],
    createRelease: ["POST /repos/{owner}/{repo}/releases"],
    createUsingTemplate: ["POST /repos/{template_owner}/{template_repo}/generate", {
      mediaType: {
        previews: ["baptiste"]
      }
    }],
    createWebhook: ["POST /repos/{owner}/{repo}/hooks"],
    declineInvitation: ["DELETE /user/repository_invitations/{invitation_id}"],
    delete: ["DELETE /repos/{owner}/{repo}"],
    deleteAccessRestrictions: ["DELETE /repos/{owner}/{repo}/branches/{branch}/protection/restrictions"],
    deleteAdminBranchProtection: ["DELETE /repos/{owner}/{repo}/branches/{branch}/protection/enforce_admins"],
    deleteBranchProtection: ["DELETE /repos/{owner}/{repo}/branches/{branch}/protection"],
    deleteCommitComment: ["DELETE /repos/{owner}/{repo}/comments/{comment_id}"],
    deleteCommitSignatureProtection: ["DELETE /repos/{owner}/{repo}/branches/{branch}/protection/required_signatures", {
      mediaType: {
        previews: ["zzzax"]
      }
    }],
    deleteDeployKey: ["DELETE /repos/{owner}/{repo}/keys/{key_id}"],
    deleteDeployment: ["DELETE /repos/{owner}/{repo}/deployments/{deployment_id}"],
    deleteFile: ["DELETE /repos/{owner}/{repo}/contents/{path}"],
    deleteInvitation: ["DELETE /repos/{owner}/{repo}/invitations/{invitation_id}"],
    deletePagesSite: ["DELETE /repos/{owner}/{repo}/pages", {
      mediaType: {
        previews: ["switcheroo"]
      }
    }],
    deletePullRequestReviewProtection: ["DELETE /repos/{owner}/{repo}/branches/{branch}/protection/required_pull_request_reviews"],
    deleteRelease: ["DELETE /repos/{owner}/{repo}/releases/{release_id}"],
    deleteReleaseAsset: ["DELETE /repos/{owner}/{repo}/releases/assets/{asset_id}"],
    deleteWebhook: ["DELETE /repos/{owner}/{repo}/hooks/{hook_id}"],
    disableAutomatedSecurityFixes: ["DELETE /repos/{owner}/{repo}/automated-security-fixes", {
      mediaType: {
        previews: ["london"]
      }
    }],
    disableVulnerabilityAlerts: ["DELETE /repos/{owner}/{repo}/vulnerability-alerts", {
      mediaType: {
        previews: ["dorian"]
      }
    }],
    downloadArchive: ["GET /repos/{owner}/{repo}/{archive_format}/{ref}"],
    enableAutomatedSecurityFixes: ["PUT /repos/{owner}/{repo}/automated-security-fixes", {
      mediaType: {
        previews: ["london"]
      }
    }],
    enableVulnerabilityAlerts: ["PUT /repos/{owner}/{repo}/vulnerability-alerts", {
      mediaType: {
        previews: ["dorian"]
      }
    }],
    get: ["GET /repos/{owner}/{repo}"],
    getAccessRestrictions: ["GET /repos/{owner}/{repo}/branches/{branch}/protection/restrictions"],
    getAdminBranchProtection: ["GET /repos/{owner}/{repo}/branches/{branch}/protection/enforce_admins"],
    getAllStatusCheckContexts: ["GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks/contexts"],
    getAllTopics: ["GET /repos/{owner}/{repo}/topics", {
      mediaType: {
        previews: ["mercy"]
      }
    }],
    getAppsWithAccessToProtectedBranch: ["GET /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/apps"],
    getBranch: ["GET /repos/{owner}/{repo}/branches/{branch}"],
    getBranchProtection: ["GET /repos/{owner}/{repo}/branches/{branch}/protection"],
    getClones: ["GET /repos/{owner}/{repo}/traffic/clones"],
    getCodeFrequencyStats: ["GET /repos/{owner}/{repo}/stats/code_frequency"],
    getCollaboratorPermissionLevel: ["GET /repos/{owner}/{repo}/collaborators/{username}/permission"],
    getCombinedStatusForRef: ["GET /repos/{owner}/{repo}/commits/{ref}/status"],
    getCommit: ["GET /repos/{owner}/{repo}/commits/{ref}"],
    getCommitActivityStats: ["GET /repos/{owner}/{repo}/stats/commit_activity"],
    getCommitComment: ["GET /repos/{owner}/{repo}/comments/{comment_id}"],
    getCommitSignatureProtection: ["GET /repos/{owner}/{repo}/branches/{branch}/protection/required_signatures", {
      mediaType: {
        previews: ["zzzax"]
      }
    }],
    getCommunityProfileMetrics: ["GET /repos/{owner}/{repo}/community/profile", {
      mediaType: {
        previews: ["black-panther"]
      }
    }],
    getContent: ["GET /repos/{owner}/{repo}/contents/{path}"],
    getContributorsStats: ["GET /repos/{owner}/{repo}/stats/contributors"],
    getDeployKey: ["GET /repos/{owner}/{repo}/keys/{key_id}"],
    getDeployment: ["GET /repos/{owner}/{repo}/deployments/{deployment_id}"],
    getDeploymentStatus: ["GET /repos/{owner}/{repo}/deployments/{deployment_id}/statuses/{status_id}"],
    getLatestPagesBuild: ["GET /repos/{owner}/{repo}/pages/builds/latest"],
    getLatestRelease: ["GET /repos/{owner}/{repo}/releases/latest"],
    getPages: ["GET /repos/{owner}/{repo}/pages"],
    getPagesBuild: ["GET /repos/{owner}/{repo}/pages/builds/{build_id}"],
    getParticipationStats: ["GET /repos/{owner}/{repo}/stats/participation"],
    getPullRequestReviewProtection: ["GET /repos/{owner}/{repo}/branches/{branch}/protection/required_pull_request_reviews"],
    getPunchCardStats: ["GET /repos/{owner}/{repo}/stats/punch_card"],
    getReadme: ["GET /repos/{owner}/{repo}/readme"],
    getRelease: ["GET /repos/{owner}/{repo}/releases/{release_id}"],
    getReleaseAsset: ["GET /repos/{owner}/{repo}/releases/assets/{asset_id}"],
    getReleaseByTag: ["GET /repos/{owner}/{repo}/releases/tags/{tag}"],
    getStatusChecksProtection: ["GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks"],
    getTeamsWithAccessToProtectedBranch: ["GET /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/teams"],
    getTopPaths: ["GET /repos/{owner}/{repo}/traffic/popular/paths"],
    getTopReferrers: ["GET /repos/{owner}/{repo}/traffic/popular/referrers"],
    getUsersWithAccessToProtectedBranch: ["GET /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/users"],
    getViews: ["GET /repos/{owner}/{repo}/traffic/views"],
    getWebhook: ["GET /repos/{owner}/{repo}/hooks/{hook_id}"],
    listBranches: ["GET /repos/{owner}/{repo}/branches"],
    listBranchesForHeadCommit: ["GET /repos/{owner}/{repo}/commits/{commit_sha}/branches-where-head", {
      mediaType: {
        previews: ["groot"]
      }
    }],
    listCollaborators: ["GET /repos/{owner}/{repo}/collaborators"],
    listCommentsForCommit: ["GET /repos/{owner}/{repo}/commits/{commit_sha}/comments"],
    listCommitCommentsForRepo: ["GET /repos/{owner}/{repo}/comments"],
    listCommitStatusesForRef: ["GET /repos/{owner}/{repo}/commits/{ref}/statuses"],
    listCommits: ["GET /repos/{owner}/{repo}/commits"],
    listContributors: ["GET /repos/{owner}/{repo}/contributors"],
    listDeployKeys: ["GET /repos/{owner}/{repo}/keys"],
    listDeploymentStatuses: ["GET /repos/{owner}/{repo}/deployments/{deployment_id}/statuses"],
    listDeployments: ["GET /repos/{owner}/{repo}/deployments"],
    listForAuthenticatedUser: ["GET /user/repos"],
    listForOrg: ["GET /orgs/{org}/repos"],
    listForUser: ["GET /users/{username}/repos"],
    listForks: ["GET /repos/{owner}/{repo}/forks"],
    listInvitations: ["GET /repos/{owner}/{repo}/invitations"],
    listInvitationsForAuthenticatedUser: ["GET /user/repository_invitations"],
    listLanguages: ["GET /repos/{owner}/{repo}/languages"],
    listPagesBuilds: ["GET /repos/{owner}/{repo}/pages/builds"],
    listPublic: ["GET /repositories"],
    listPullRequestsAssociatedWithCommit: ["GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls", {
      mediaType: {
        previews: ["groot"]
      }
    }],
    listReleaseAssets: ["GET /repos/{owner}/{repo}/releases/{release_id}/assets"],
    listReleases: ["GET /repos/{owner}/{repo}/releases"],
    listTags: ["GET /repos/{owner}/{repo}/tags"],
    listTeams: ["GET /repos/{owner}/{repo}/teams"],
    listWebhooks: ["GET /repos/{owner}/{repo}/hooks"],
    merge: ["POST /repos/{owner}/{repo}/merges"],
    pingWebhook: ["POST /repos/{owner}/{repo}/hooks/{hook_id}/pings"],
    removeAppAccessRestrictions: ["DELETE /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/apps", {}, {
      mapToData: "apps"
    }],
    removeCollaborator: ["DELETE /repos/{owner}/{repo}/collaborators/{username}"],
    removeStatusCheckContexts: ["DELETE /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks/contexts", {}, {
      mapToData: "contexts"
    }],
    removeStatusCheckProtection: ["DELETE /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks"],
    removeTeamAccessRestrictions: ["DELETE /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/teams", {}, {
      mapToData: "teams"
    }],
    removeUserAccessRestrictions: ["DELETE /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/users", {}, {
      mapToData: "users"
    }],
    replaceAllTopics: ["PUT /repos/{owner}/{repo}/topics", {
      mediaType: {
        previews: ["mercy"]
      }
    }],
    requestPagesBuild: ["POST /repos/{owner}/{repo}/pages/builds"],
    setAdminBranchProtection: ["POST /repos/{owner}/{repo}/branches/{branch}/protection/enforce_admins"],
    setAppAccessRestrictions: ["PUT /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/apps", {}, {
      mapToData: "apps"
    }],
    setStatusCheckContexts: ["PUT /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks/contexts", {}, {
      mapToData: "contexts"
    }],
    setTeamAccessRestrictions: ["PUT /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/teams", {}, {
      mapToData: "teams"
    }],
    setUserAccessRestrictions: ["PUT /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/users", {}, {
      mapToData: "users"
    }],
    testPushWebhook: ["POST /repos/{owner}/{repo}/hooks/{hook_id}/tests"],
    transfer: ["POST /repos/{owner}/{repo}/transfer"],
    update: ["PATCH /repos/{owner}/{repo}"],
    updateBranchProtection: ["PUT /repos/{owner}/{repo}/branches/{branch}/protection"],
    updateCommitComment: ["PATCH /repos/{owner}/{repo}/comments/{comment_id}"],
    updateInformationAboutPagesSite: ["PUT /repos/{owner}/{repo}/pages"],
    updateInvitation: ["PATCH /repos/{owner}/{repo}/invitations/{invitation_id}"],
    updatePullRequestReviewProtection: ["PATCH /repos/{owner}/{repo}/branches/{branch}/protection/required_pull_request_reviews"],
    updateRelease: ["PATCH /repos/{owner}/{repo}/releases/{release_id}"],
    updateReleaseAsset: ["PATCH /repos/{owner}/{repo}/releases/assets/{asset_id}"],
    updateStatusCheckPotection: ["PATCH /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks"],
    updateWebhook: ["PATCH /repos/{owner}/{repo}/hooks/{hook_id}"],
    uploadReleaseAsset: ["POST /repos/{owner}/{repo}/releases/{release_id}/assets{?name,label}", {
      baseUrl: "https://uploads.github.com"
    }]
  },
  search: {
    code: ["GET /search/code"],
    commits: ["GET /search/commits", {
      mediaType: {
        previews: ["cloak"]
      }
    }],
    issuesAndPullRequests: ["GET /search/issues"],
    labels: ["GET /search/labels"],
    repos: ["GET /search/repositories"],
    topics: ["GET /search/topics", {
      mediaType: {
        previews: ["mercy"]
      }
    }],
    users: ["GET /search/users"]
  },
  teams: {
    addOrUpdateMembershipForUserInOrg: ["PUT /orgs/{org}/teams/{team_slug}/memberships/{username}"],
    addOrUpdateProjectPermissionsInOrg: ["PUT /orgs/{org}/teams/{team_slug}/projects/{project_id}", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    addOrUpdateRepoPermissionsInOrg: ["PUT /orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}"],
    checkPermissionsForProjectInOrg: ["GET /orgs/{org}/teams/{team_slug}/projects/{project_id}", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    checkPermissionsForRepoInOrg: ["GET /orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}"],
    create: ["POST /orgs/{org}/teams"],
    createDiscussionCommentInOrg: ["POST /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/comments"],
    createDiscussionInOrg: ["POST /orgs/{org}/teams/{team_slug}/discussions"],
    deleteDiscussionCommentInOrg: ["DELETE /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/comments/{comment_number}"],
    deleteDiscussionInOrg: ["DELETE /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}"],
    deleteInOrg: ["DELETE /orgs/{org}/teams/{team_slug}"],
    getByName: ["GET /orgs/{org}/teams/{team_slug}"],
    getDiscussionCommentInOrg: ["GET /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/comments/{comment_number}"],
    getDiscussionInOrg: ["GET /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}"],
    getMembershipForUserInOrg: ["GET /orgs/{org}/teams/{team_slug}/memberships/{username}"],
    list: ["GET /orgs/{org}/teams"],
    listChildInOrg: ["GET /orgs/{org}/teams/{team_slug}/teams"],
    listDiscussionCommentsInOrg: ["GET /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/comments"],
    listDiscussionsInOrg: ["GET /orgs/{org}/teams/{team_slug}/discussions"],
    listForAuthenticatedUser: ["GET /user/teams"],
    listMembersInOrg: ["GET /orgs/{org}/teams/{team_slug}/members"],
    listPendingInvitationsInOrg: ["GET /orgs/{org}/teams/{team_slug}/invitations"],
    listProjectsInOrg: ["GET /orgs/{org}/teams/{team_slug}/projects", {
      mediaType: {
        previews: ["inertia"]
      }
    }],
    listReposInOrg: ["GET /orgs/{org}/teams/{team_slug}/repos"],
    removeMembershipForUserInOrg: ["DELETE /orgs/{org}/teams/{team_slug}/memberships/{username}"],
    removeProjectInOrg: ["DELETE /orgs/{org}/teams/{team_slug}/projects/{project_id}"],
    removeRepoInOrg: ["DELETE /orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}"],
    updateDiscussionCommentInOrg: ["PATCH /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/comments/{comment_number}"],
    updateDiscussionInOrg: ["PATCH /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}"],
    updateInOrg: ["PATCH /orgs/{org}/teams/{team_slug}"]
  },
  users: {
    addEmailForAuthenticated: ["POST /user/emails"],
    block: ["PUT /user/blocks/{username}"],
    checkBlocked: ["GET /user/blocks/{username}"],
    checkFollowingForUser: ["GET /users/{username}/following/{target_user}"],
    checkPersonIsFollowedByAuthenticated: ["GET /user/following/{username}"],
    createGpgKeyForAuthenticated: ["POST /user/gpg_keys"],
    createPublicSshKeyForAuthenticated: ["POST /user/keys"],
    deleteEmailForAuthenticated: ["DELETE /user/emails"],
    deleteGpgKeyForAuthenticated: ["DELETE /user/gpg_keys/{gpg_key_id}"],
    deletePublicSshKeyForAuthenticated: ["DELETE /user/keys/{key_id}"],
    follow: ["PUT /user/following/{username}"],
    getAuthenticated: ["GET /user"],
    getByUsername: ["GET /users/{username}"],
    getContextForUser: ["GET /users/{username}/hovercard"],
    getGpgKeyForAuthenticated: ["GET /user/gpg_keys/{gpg_key_id}"],
    getPublicSshKeyForAuthenticated: ["GET /user/keys/{key_id}"],
    list: ["GET /users"],
    listBlockedByAuthenticated: ["GET /user/blocks"],
    listEmailsForAuthenticated: ["GET /user/emails"],
    listFollowedByAuthenticated: ["GET /user/following"],
    listFollowersForAuthenticatedUser: ["GET /user/followers"],
    listFollowersForUser: ["GET /users/{username}/followers"],
    listFollowingForUser: ["GET /users/{username}/following"],
    listGpgKeysForAuthenticated: ["GET /user/gpg_keys"],
    listGpgKeysForUser: ["GET /users/{username}/gpg_keys"],
    listPublicEmailsForAuthenticated: ["GET /user/public_emails"],
    listPublicKeysForUser: ["GET /users/{username}/keys"],
    listPublicSshKeysForAuthenticated: ["GET /user/keys"],
    setPrimaryEmailVisibilityForAuthenticated: ["PATCH /user/email/visibility"],
    unblock: ["DELETE /user/blocks/{username}"],
    unfollow: ["DELETE /user/following/{username}"],
    updateAuthenticated: ["PATCH /user"]
  }
};

const VERSION = "4.1.3";

function endpointsToMethods(octokit, endpointsMap) {
  const newMethods = {};

  for (const [scope, endpoints] of Object.entries(endpointsMap)) {
    for (const [methodName, endpoint] of Object.entries(endpoints)) {
      const [route, defaults, decorations] = endpoint;
      const [method, url] = route.split(/ /);
      const endpointDefaults = Object.assign({
        method,
        url
      }, defaults);

      if (!newMethods[scope]) {
        newMethods[scope] = {};
      }

      const scopeMethods = newMethods[scope];

      if (decorations) {
        scopeMethods[methodName] = decorate(octokit, scope, methodName, endpointDefaults, decorations);
        continue;
      }

      scopeMethods[methodName] = octokit.request.defaults(endpointDefaults);
    }
  }

  return newMethods;
}

function decorate(octokit, scope, methodName, defaults, decorations) {
  const requestWithDefaults = octokit.request.defaults(defaults);
  /* istanbul ignore next */

  function withDecorations(...args) {
    // @ts-ignore https://github.com/microsoft/TypeScript/issues/25488
    let options = requestWithDefaults.endpoint.merge(...args); // There are currently no other decorations than `.mapToData`

    if (decorations.mapToData) {
      options = Object.assign({}, options, {
        data: options[decorations.mapToData],
        [decorations.mapToData]: undefined
      });
      return requestWithDefaults(options);
    }

    if (decorations.renamed) {
      const [newScope, newMethodName] = decorations.renamed;
      octokit.log.warn(`octokit.${scope}.${methodName}() has been renamed to octokit.${newScope}.${newMethodName}()`);
    }

    if (decorations.deprecated) {
      octokit.log.warn(decorations.deprecated);
    }

    if (decorations.renamedParameters) {
      // @ts-ignore https://github.com/microsoft/TypeScript/issues/25488
      const options = requestWithDefaults.endpoint.merge(...args);

      for (const [name, alias] of Object.entries(decorations.renamedParameters)) {
        if (name in options) {
          octokit.log.warn(`"${name}" parameter is deprecated for "octokit.${scope}.${methodName}()". Use "${alias}" instead`);

          if (!(alias in options)) {
            options[alias] = options[name];
          }

          delete options[name];
        }
      }

      return requestWithDefaults(options);
    } // @ts-ignore https://github.com/microsoft/TypeScript/issues/25488


    return requestWithDefaults(...args);
  }

  return Object.assign(withDecorations, requestWithDefaults);
}

/**
 * This plugin is a 1:1 copy of internal @octokit/rest plugins. The primary
 * goal is to rebuild @octokit/rest on top of @octokit/core. Once that is
 * done, we will remove the registerEndpoints methods and return the methods
 * directly as with the other plugins. At that point we will also remove the
 * legacy workarounds and deprecations.
 *
 * See the plan at
 * https://github.com/octokit/plugin-rest-endpoint-methods.js/pull/1
 */

function restEndpointMethods(octokit) {
  return endpointsToMethods(octokit, Endpoints);
}
restEndpointMethods.VERSION = VERSION;

exports.restEndpointMethods = restEndpointMethods;
//# sourceMappingURL=index.js.map


/***/ }),

/***/ 537:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";


Object.defineProperty(exports, "__esModule", ({ value: true }));

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var deprecation = __webpack_require__(8932);
var once = _interopDefault(__webpack_require__(1223));

const logOnce = once(deprecation => console.warn(deprecation));
/**
 * Error with extra properties to help with debugging
 */

class RequestError extends Error {
  constructor(message, statusCode, options) {
    super(message); // Maintains proper stack trace (only available on V8)

    /* istanbul ignore next */

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    this.name = "HttpError";
    this.status = statusCode;
    Object.defineProperty(this, "code", {
      get() {
        logOnce(new deprecation.Deprecation("[@octokit/request-error] `error.code` is deprecated, use `error.status`."));
        return statusCode;
      }

    });
    this.headers = options.headers || {}; // redact request credentials without mutating original request options

    const requestCopy = Object.assign({}, options.request);

    if (options.request.headers.authorization) {
      requestCopy.headers = Object.assign({}, options.request.headers, {
        authorization: options.request.headers.authorization.replace(/ .*$/, " [REDACTED]")
      });
    }

    requestCopy.url = requestCopy.url // client_id & client_secret can be passed as URL query parameters to increase rate limit
    // see https://developer.github.com/v3/#increasing-the-unauthenticated-rate-limit-for-oauth-applications
    .replace(/\bclient_secret=\w+/g, "client_secret=[REDACTED]") // OAuth tokens can be passed as URL query parameters, although it is not recommended
    // see https://developer.github.com/v3/#oauth2-token-sent-in-a-header
    .replace(/\baccess_token=\w+/g, "access_token=[REDACTED]");
    this.request = requestCopy;
  }

}

exports.RequestError = RequestError;
//# sourceMappingURL=index.js.map


/***/ }),

/***/ 6234:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";


Object.defineProperty(exports, "__esModule", ({ value: true }));

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var endpoint = __webpack_require__(9440);
var universalUserAgent = __webpack_require__(5030);
var isPlainObject = _interopDefault(__webpack_require__(9886));
var nodeFetch = _interopDefault(__webpack_require__(467));
var requestError = __webpack_require__(537);

const VERSION = "5.4.7";

function getBufferResponse(response) {
  return response.arrayBuffer();
}

function fetchWrapper(requestOptions) {
  if (isPlainObject(requestOptions.body) || Array.isArray(requestOptions.body)) {
    requestOptions.body = JSON.stringify(requestOptions.body);
  }

  let headers = {};
  let status;
  let url;
  const fetch = requestOptions.request && requestOptions.request.fetch || nodeFetch;
  return fetch(requestOptions.url, Object.assign({
    method: requestOptions.method,
    body: requestOptions.body,
    headers: requestOptions.headers,
    redirect: requestOptions.redirect
  }, requestOptions.request)).then(response => {
    url = response.url;
    status = response.status;

    for (const keyAndValue of response.headers) {
      headers[keyAndValue[0]] = keyAndValue[1];
    }

    if (status === 204 || status === 205) {
      return;
    } // GitHub API returns 200 for HEAD requests


    if (requestOptions.method === "HEAD") {
      if (status < 400) {
        return;
      }

      throw new requestError.RequestError(response.statusText, status, {
        headers,
        request: requestOptions
      });
    }

    if (status === 304) {
      throw new requestError.RequestError("Not modified", status, {
        headers,
        request: requestOptions
      });
    }

    if (status >= 400) {
      return response.text().then(message => {
        const error = new requestError.RequestError(message, status, {
          headers,
          request: requestOptions
        });

        try {
          let responseBody = JSON.parse(error.message);
          Object.assign(error, responseBody);
          let errors = responseBody.errors; // Assumption `errors` would always be in Array format

          error.message = error.message + ": " + errors.map(JSON.stringify).join(", ");
        } catch (e) {// ignore, see octokit/rest.js#684
        }

        throw error;
      });
    }

    const contentType = response.headers.get("content-type");

    if (/application\/json/.test(contentType)) {
      return response.json();
    }

    if (!contentType || /^text\/|charset=utf-8$/.test(contentType)) {
      return response.text();
    }

    return getBufferResponse(response);
  }).then(data => {
    return {
      status,
      url,
      headers,
      data
    };
  }).catch(error => {
    if (error instanceof requestError.RequestError) {
      throw error;
    }

    throw new requestError.RequestError(error.message, 500, {
      headers,
      request: requestOptions
    });
  });
}

function withDefaults(oldEndpoint, newDefaults) {
  const endpoint = oldEndpoint.defaults(newDefaults);

  const newApi = function (route, parameters) {
    const endpointOptions = endpoint.merge(route, parameters);

    if (!endpointOptions.request || !endpointOptions.request.hook) {
      return fetchWrapper(endpoint.parse(endpointOptions));
    }

    const request = (route, parameters) => {
      return fetchWrapper(endpoint.parse(endpoint.merge(route, parameters)));
    };

    Object.assign(request, {
      endpoint,
      defaults: withDefaults.bind(null, endpoint)
    });
    return endpointOptions.request.hook(request, endpointOptions);
  };

  return Object.assign(newApi, {
    endpoint,
    defaults: withDefaults.bind(null, endpoint)
  });
}

const request = withDefaults(endpoint.endpoint, {
  headers: {
    "user-agent": `octokit-request.js/${VERSION} ${universalUserAgent.getUserAgent()}`
  }
});

exports.request = request;
//# sourceMappingURL=index.js.map


/***/ }),

/***/ 9886:
/***/ ((module) => {

"use strict";


/*!
 * is-plain-object <https://github.com/jonschlinkert/is-plain-object>
 *
 * Copyright (c) 2014-2017, Jon Schlinkert.
 * Released under the MIT License.
 */

function isObject(o) {
  return Object.prototype.toString.call(o) === '[object Object]';
}

function isPlainObject(o) {
  var ctor,prot;

  if (isObject(o) === false) return false;

  // If has modified constructor
  ctor = o.constructor;
  if (ctor === undefined) return true;

  // If has modified prototype
  prot = ctor.prototype;
  if (isObject(prot) === false) return false;

  // If constructor does not have an Object-specific method
  if (prot.hasOwnProperty('isPrototypeOf') === false) {
    return false;
  }

  // Most likely a plain Object
  return true;
}

module.exports = isPlainObject;


/***/ }),

/***/ 5375:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";


Object.defineProperty(exports, "__esModule", ({ value: true }));

var core = __webpack_require__(6762);
var pluginRequestLog = __webpack_require__(8883);
var pluginPaginateRest = __webpack_require__(4193);
var pluginRestEndpointMethods = __webpack_require__(3044);

const VERSION = "18.0.4";

const Octokit = core.Octokit.plugin(pluginRequestLog.requestLog, pluginRestEndpointMethods.restEndpointMethods, pluginPaginateRest.paginateRest).defaults({
  userAgent: `octokit-rest.js/${VERSION}`
});

exports.Octokit = Octokit;
//# sourceMappingURL=index.js.map


/***/ }),

/***/ 3682:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

var register = __webpack_require__(4670)
var addHook = __webpack_require__(5549)
var removeHook = __webpack_require__(6819)

// bind with array of arguments: https://stackoverflow.com/a/21792913
var bind = Function.bind
var bindable = bind.bind(bind)

function bindApi (hook, state, name) {
  var removeHookRef = bindable(removeHook, null).apply(null, name ? [state, name] : [state])
  hook.api = { remove: removeHookRef }
  hook.remove = removeHookRef

  ;['before', 'error', 'after', 'wrap'].forEach(function (kind) {
    var args = name ? [state, kind, name] : [state, kind]
    hook[kind] = hook.api[kind] = bindable(addHook, null).apply(null, args)
  })
}

function HookSingular () {
  var singularHookName = 'h'
  var singularHookState = {
    registry: {}
  }
  var singularHook = register.bind(null, singularHookState, singularHookName)
  bindApi(singularHook, singularHookState, singularHookName)
  return singularHook
}

function HookCollection () {
  var state = {
    registry: {}
  }

  var hook = register.bind(null, state)
  bindApi(hook, state)

  return hook
}

var collectionHookDeprecationMessageDisplayed = false
function Hook () {
  if (!collectionHookDeprecationMessageDisplayed) {
    console.warn('[before-after-hook]: "Hook()" repurposing warning, use "Hook.Collection()". Read more: https://git.io/upgrade-before-after-hook-to-1.4')
    collectionHookDeprecationMessageDisplayed = true
  }
  return HookCollection()
}

Hook.Singular = HookSingular.bind()
Hook.Collection = HookCollection.bind()

module.exports = Hook
// expose constructors as a named property for TypeScript
module.exports.Hook = Hook
module.exports.Singular = Hook.Singular
module.exports.Collection = Hook.Collection


/***/ }),

/***/ 5549:
/***/ ((module) => {

module.exports = addHook

function addHook (state, kind, name, hook) {
  var orig = hook
  if (!state.registry[name]) {
    state.registry[name] = []
  }

  if (kind === 'before') {
    hook = function (method, options) {
      return Promise.resolve()
        .then(orig.bind(null, options))
        .then(method.bind(null, options))
    }
  }

  if (kind === 'after') {
    hook = function (method, options) {
      var result
      return Promise.resolve()
        .then(method.bind(null, options))
        .then(function (result_) {
          result = result_
          return orig(result, options)
        })
        .then(function () {
          return result
        })
    }
  }

  if (kind === 'error') {
    hook = function (method, options) {
      return Promise.resolve()
        .then(method.bind(null, options))
        .catch(function (error) {
          return orig(error, options)
        })
    }
  }

  state.registry[name].push({
    hook: hook,
    orig: orig
  })
}


/***/ }),

/***/ 4670:
/***/ ((module) => {

module.exports = register

function register (state, name, method, options) {
  if (typeof method !== 'function') {
    throw new Error('method for before hook must be a function')
  }

  if (!options) {
    options = {}
  }

  if (Array.isArray(name)) {
    return name.reverse().reduce(function (callback, name) {
      return register.bind(null, state, name, callback, options)
    }, method)()
  }

  return Promise.resolve()
    .then(function () {
      if (!state.registry[name]) {
        return method(options)
      }

      return (state.registry[name]).reduce(function (method, registered) {
        return registered.hook.bind(null, method, options)
      }, method)()
    })
}


/***/ }),

/***/ 6819:
/***/ ((module) => {

module.exports = removeHook

function removeHook (state, name, method) {
  if (!state.registry[name]) {
    return
  }

  var index = state.registry[name]
    .map(function (registered) { return registered.orig })
    .indexOf(method)

  if (index === -1) {
    return
  }

  state.registry[name].splice(index, 1)
}


/***/ }),

/***/ 8932:
/***/ ((__unused_webpack_module, exports) => {

"use strict";


Object.defineProperty(exports, "__esModule", ({ value: true }));

class Deprecation extends Error {
  constructor(message) {
    super(message); // Maintains proper stack trace (only available on V8)

    /* istanbul ignore next */

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    this.name = 'Deprecation';
  }

}

exports.Deprecation = Deprecation;


/***/ }),

/***/ 9126:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";

const fs = __webpack_require__(5747);
const path = __webpack_require__(5622);
const {promisify} = __webpack_require__(1669);
const semver = __webpack_require__(3689);

const useNativeRecursiveOption = semver.satisfies(process.version, '>=10.12.0');

// https://github.com/nodejs/node/issues/8987
// https://github.com/libuv/libuv/pull/1088
const checkPath = pth => {
	if (process.platform === 'win32') {
		const pathHasInvalidWinCharacters = /[<>:"|?*]/.test(pth.replace(path.parse(pth).root, ''));

		if (pathHasInvalidWinCharacters) {
			const error = new Error(`Path contains invalid characters: ${pth}`);
			error.code = 'EINVAL';
			throw error;
		}
	}
};

const processOptions = options => {
	// https://github.com/sindresorhus/make-dir/issues/18
	const defaults = {
		mode: 0o777,
		fs
	};

	return {
		...defaults,
		...options
	};
};

const permissionError = pth => {
	// This replicates the exception of `fs.mkdir` with native the
	// `recusive` option when run on an invalid drive under Windows.
	const error = new Error(`operation not permitted, mkdir '${pth}'`);
	error.code = 'EPERM';
	error.errno = -4048;
	error.path = pth;
	error.syscall = 'mkdir';
	return error;
};

const makeDir = async (input, options) => {
	checkPath(input);
	options = processOptions(options);

	const mkdir = promisify(options.fs.mkdir);
	const stat = promisify(options.fs.stat);

	if (useNativeRecursiveOption && options.fs.mkdir === fs.mkdir) {
		const pth = path.resolve(input);

		await mkdir(pth, {
			mode: options.mode,
			recursive: true
		});

		return pth;
	}

	const make = async pth => {
		try {
			await mkdir(pth, options.mode);

			return pth;
		} catch (error) {
			if (error.code === 'EPERM') {
				throw error;
			}

			if (error.code === 'ENOENT') {
				if (path.dirname(pth) === pth) {
					throw permissionError(pth);
				}

				if (error.message.includes('null bytes')) {
					throw error;
				}

				await make(path.dirname(pth));

				return make(pth);
			}

			try {
				const stats = await stat(pth);
				if (!stats.isDirectory()) {
					throw new Error('The path is not a directory');
				}
			} catch (_) {
				throw error;
			}

			return pth;
		}
	};

	return make(path.resolve(input));
};

module.exports = makeDir;

module.exports.sync = (input, options) => {
	checkPath(input);
	options = processOptions(options);

	if (useNativeRecursiveOption && options.fs.mkdirSync === fs.mkdirSync) {
		const pth = path.resolve(input);

		fs.mkdirSync(pth, {
			mode: options.mode,
			recursive: true
		});

		return pth;
	}

	const make = pth => {
		try {
			options.fs.mkdirSync(pth, options.mode);
		} catch (error) {
			if (error.code === 'EPERM') {
				throw error;
			}

			if (error.code === 'ENOENT') {
				if (path.dirname(pth) === pth) {
					throw permissionError(pth);
				}

				if (error.message.includes('null bytes')) {
					throw error;
				}

				make(path.dirname(pth));
				return make(pth);
			}

			try {
				if (!options.fs.statSync(pth).isDirectory()) {
					throw new Error('The path is not a directory');
				}
			} catch (_) {
				throw error;
			}
		}

		return pth;
	};

	return make(path.resolve(input));
};


/***/ }),

/***/ 3689:
/***/ ((module, exports) => {

exports = module.exports = SemVer

var debug
/* istanbul ignore next */
if (typeof process === 'object' &&
    process.env &&
    process.env.NODE_DEBUG &&
    /\bsemver\b/i.test(process.env.NODE_DEBUG)) {
  debug = function () {
    var args = Array.prototype.slice.call(arguments, 0)
    args.unshift('SEMVER')
    console.log.apply(console, args)
  }
} else {
  debug = function () {}
}

// Note: this is the semver.org version of the spec that it implements
// Not necessarily the package version of this code.
exports.SEMVER_SPEC_VERSION = '2.0.0'

var MAX_LENGTH = 256
var MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER ||
  /* istanbul ignore next */ 9007199254740991

// Max safe segment length for coercion.
var MAX_SAFE_COMPONENT_LENGTH = 16

// The actual regexps go on exports.re
var re = exports.re = []
var src = exports.src = []
var t = exports.tokens = {}
var R = 0

function tok (n) {
  t[n] = R++
}

// The following Regular Expressions can be used for tokenizing,
// validating, and parsing SemVer version strings.

// ## Numeric Identifier
// A single `0`, or a non-zero digit followed by zero or more digits.

tok('NUMERICIDENTIFIER')
src[t.NUMERICIDENTIFIER] = '0|[1-9]\\d*'
tok('NUMERICIDENTIFIERLOOSE')
src[t.NUMERICIDENTIFIERLOOSE] = '[0-9]+'

// ## Non-numeric Identifier
// Zero or more digits, followed by a letter or hyphen, and then zero or
// more letters, digits, or hyphens.

tok('NONNUMERICIDENTIFIER')
src[t.NONNUMERICIDENTIFIER] = '\\d*[a-zA-Z-][a-zA-Z0-9-]*'

// ## Main Version
// Three dot-separated numeric identifiers.

tok('MAINVERSION')
src[t.MAINVERSION] = '(' + src[t.NUMERICIDENTIFIER] + ')\\.' +
                   '(' + src[t.NUMERICIDENTIFIER] + ')\\.' +
                   '(' + src[t.NUMERICIDENTIFIER] + ')'

tok('MAINVERSIONLOOSE')
src[t.MAINVERSIONLOOSE] = '(' + src[t.NUMERICIDENTIFIERLOOSE] + ')\\.' +
                        '(' + src[t.NUMERICIDENTIFIERLOOSE] + ')\\.' +
                        '(' + src[t.NUMERICIDENTIFIERLOOSE] + ')'

// ## Pre-release Version Identifier
// A numeric identifier, or a non-numeric identifier.

tok('PRERELEASEIDENTIFIER')
src[t.PRERELEASEIDENTIFIER] = '(?:' + src[t.NUMERICIDENTIFIER] +
                            '|' + src[t.NONNUMERICIDENTIFIER] + ')'

tok('PRERELEASEIDENTIFIERLOOSE')
src[t.PRERELEASEIDENTIFIERLOOSE] = '(?:' + src[t.NUMERICIDENTIFIERLOOSE] +
                                 '|' + src[t.NONNUMERICIDENTIFIER] + ')'

// ## Pre-release Version
// Hyphen, followed by one or more dot-separated pre-release version
// identifiers.

tok('PRERELEASE')
src[t.PRERELEASE] = '(?:-(' + src[t.PRERELEASEIDENTIFIER] +
                  '(?:\\.' + src[t.PRERELEASEIDENTIFIER] + ')*))'

tok('PRERELEASELOOSE')
src[t.PRERELEASELOOSE] = '(?:-?(' + src[t.PRERELEASEIDENTIFIERLOOSE] +
                       '(?:\\.' + src[t.PRERELEASEIDENTIFIERLOOSE] + ')*))'

// ## Build Metadata Identifier
// Any combination of digits, letters, or hyphens.

tok('BUILDIDENTIFIER')
src[t.BUILDIDENTIFIER] = '[0-9A-Za-z-]+'

// ## Build Metadata
// Plus sign, followed by one or more period-separated build metadata
// identifiers.

tok('BUILD')
src[t.BUILD] = '(?:\\+(' + src[t.BUILDIDENTIFIER] +
             '(?:\\.' + src[t.BUILDIDENTIFIER] + ')*))'

// ## Full Version String
// A main version, followed optionally by a pre-release version and
// build metadata.

// Note that the only major, minor, patch, and pre-release sections of
// the version string are capturing groups.  The build metadata is not a
// capturing group, because it should not ever be used in version
// comparison.

tok('FULL')
tok('FULLPLAIN')
src[t.FULLPLAIN] = 'v?' + src[t.MAINVERSION] +
                  src[t.PRERELEASE] + '?' +
                  src[t.BUILD] + '?'

src[t.FULL] = '^' + src[t.FULLPLAIN] + '$'

// like full, but allows v1.2.3 and =1.2.3, which people do sometimes.
// also, 1.0.0alpha1 (prerelease without the hyphen) which is pretty
// common in the npm registry.
tok('LOOSEPLAIN')
src[t.LOOSEPLAIN] = '[v=\\s]*' + src[t.MAINVERSIONLOOSE] +
                  src[t.PRERELEASELOOSE] + '?' +
                  src[t.BUILD] + '?'

tok('LOOSE')
src[t.LOOSE] = '^' + src[t.LOOSEPLAIN] + '$'

tok('GTLT')
src[t.GTLT] = '((?:<|>)?=?)'

// Something like "2.*" or "1.2.x".
// Note that "x.x" is a valid xRange identifer, meaning "any version"
// Only the first item is strictly required.
tok('XRANGEIDENTIFIERLOOSE')
src[t.XRANGEIDENTIFIERLOOSE] = src[t.NUMERICIDENTIFIERLOOSE] + '|x|X|\\*'
tok('XRANGEIDENTIFIER')
src[t.XRANGEIDENTIFIER] = src[t.NUMERICIDENTIFIER] + '|x|X|\\*'

tok('XRANGEPLAIN')
src[t.XRANGEPLAIN] = '[v=\\s]*(' + src[t.XRANGEIDENTIFIER] + ')' +
                   '(?:\\.(' + src[t.XRANGEIDENTIFIER] + ')' +
                   '(?:\\.(' + src[t.XRANGEIDENTIFIER] + ')' +
                   '(?:' + src[t.PRERELEASE] + ')?' +
                   src[t.BUILD] + '?' +
                   ')?)?'

tok('XRANGEPLAINLOOSE')
src[t.XRANGEPLAINLOOSE] = '[v=\\s]*(' + src[t.XRANGEIDENTIFIERLOOSE] + ')' +
                        '(?:\\.(' + src[t.XRANGEIDENTIFIERLOOSE] + ')' +
                        '(?:\\.(' + src[t.XRANGEIDENTIFIERLOOSE] + ')' +
                        '(?:' + src[t.PRERELEASELOOSE] + ')?' +
                        src[t.BUILD] + '?' +
                        ')?)?'

tok('XRANGE')
src[t.XRANGE] = '^' + src[t.GTLT] + '\\s*' + src[t.XRANGEPLAIN] + '$'
tok('XRANGELOOSE')
src[t.XRANGELOOSE] = '^' + src[t.GTLT] + '\\s*' + src[t.XRANGEPLAINLOOSE] + '$'

// Coercion.
// Extract anything that could conceivably be a part of a valid semver
tok('COERCE')
src[t.COERCE] = '(^|[^\\d])' +
              '(\\d{1,' + MAX_SAFE_COMPONENT_LENGTH + '})' +
              '(?:\\.(\\d{1,' + MAX_SAFE_COMPONENT_LENGTH + '}))?' +
              '(?:\\.(\\d{1,' + MAX_SAFE_COMPONENT_LENGTH + '}))?' +
              '(?:$|[^\\d])'
tok('COERCERTL')
re[t.COERCERTL] = new RegExp(src[t.COERCE], 'g')

// Tilde ranges.
// Meaning is "reasonably at or greater than"
tok('LONETILDE')
src[t.LONETILDE] = '(?:~>?)'

tok('TILDETRIM')
src[t.TILDETRIM] = '(\\s*)' + src[t.LONETILDE] + '\\s+'
re[t.TILDETRIM] = new RegExp(src[t.TILDETRIM], 'g')
var tildeTrimReplace = '$1~'

tok('TILDE')
src[t.TILDE] = '^' + src[t.LONETILDE] + src[t.XRANGEPLAIN] + '$'
tok('TILDELOOSE')
src[t.TILDELOOSE] = '^' + src[t.LONETILDE] + src[t.XRANGEPLAINLOOSE] + '$'

// Caret ranges.
// Meaning is "at least and backwards compatible with"
tok('LONECARET')
src[t.LONECARET] = '(?:\\^)'

tok('CARETTRIM')
src[t.CARETTRIM] = '(\\s*)' + src[t.LONECARET] + '\\s+'
re[t.CARETTRIM] = new RegExp(src[t.CARETTRIM], 'g')
var caretTrimReplace = '$1^'

tok('CARET')
src[t.CARET] = '^' + src[t.LONECARET] + src[t.XRANGEPLAIN] + '$'
tok('CARETLOOSE')
src[t.CARETLOOSE] = '^' + src[t.LONECARET] + src[t.XRANGEPLAINLOOSE] + '$'

// A simple gt/lt/eq thing, or just "" to indicate "any version"
tok('COMPARATORLOOSE')
src[t.COMPARATORLOOSE] = '^' + src[t.GTLT] + '\\s*(' + src[t.LOOSEPLAIN] + ')$|^$'
tok('COMPARATOR')
src[t.COMPARATOR] = '^' + src[t.GTLT] + '\\s*(' + src[t.FULLPLAIN] + ')$|^$'

// An expression to strip any whitespace between the gtlt and the thing
// it modifies, so that `> 1.2.3` ==> `>1.2.3`
tok('COMPARATORTRIM')
src[t.COMPARATORTRIM] = '(\\s*)' + src[t.GTLT] +
                      '\\s*(' + src[t.LOOSEPLAIN] + '|' + src[t.XRANGEPLAIN] + ')'

// this one has to use the /g flag
re[t.COMPARATORTRIM] = new RegExp(src[t.COMPARATORTRIM], 'g')
var comparatorTrimReplace = '$1$2$3'

// Something like `1.2.3 - 1.2.4`
// Note that these all use the loose form, because they'll be
// checked against either the strict or loose comparator form
// later.
tok('HYPHENRANGE')
src[t.HYPHENRANGE] = '^\\s*(' + src[t.XRANGEPLAIN] + ')' +
                   '\\s+-\\s+' +
                   '(' + src[t.XRANGEPLAIN] + ')' +
                   '\\s*$'

tok('HYPHENRANGELOOSE')
src[t.HYPHENRANGELOOSE] = '^\\s*(' + src[t.XRANGEPLAINLOOSE] + ')' +
                        '\\s+-\\s+' +
                        '(' + src[t.XRANGEPLAINLOOSE] + ')' +
                        '\\s*$'

// Star ranges basically just allow anything at all.
tok('STAR')
src[t.STAR] = '(<|>)?=?\\s*\\*'

// Compile to actual regexp objects.
// All are flag-free, unless they were created above with a flag.
for (var i = 0; i < R; i++) {
  debug(i, src[i])
  if (!re[i]) {
    re[i] = new RegExp(src[i])
  }
}

exports.parse = parse
function parse (version, options) {
  if (!options || typeof options !== 'object') {
    options = {
      loose: !!options,
      includePrerelease: false
    }
  }

  if (version instanceof SemVer) {
    return version
  }

  if (typeof version !== 'string') {
    return null
  }

  if (version.length > MAX_LENGTH) {
    return null
  }

  var r = options.loose ? re[t.LOOSE] : re[t.FULL]
  if (!r.test(version)) {
    return null
  }

  try {
    return new SemVer(version, options)
  } catch (er) {
    return null
  }
}

exports.valid = valid
function valid (version, options) {
  var v = parse(version, options)
  return v ? v.version : null
}

exports.clean = clean
function clean (version, options) {
  var s = parse(version.trim().replace(/^[=v]+/, ''), options)
  return s ? s.version : null
}

exports.SemVer = SemVer

function SemVer (version, options) {
  if (!options || typeof options !== 'object') {
    options = {
      loose: !!options,
      includePrerelease: false
    }
  }
  if (version instanceof SemVer) {
    if (version.loose === options.loose) {
      return version
    } else {
      version = version.version
    }
  } else if (typeof version !== 'string') {
    throw new TypeError('Invalid Version: ' + version)
  }

  if (version.length > MAX_LENGTH) {
    throw new TypeError('version is longer than ' + MAX_LENGTH + ' characters')
  }

  if (!(this instanceof SemVer)) {
    return new SemVer(version, options)
  }

  debug('SemVer', version, options)
  this.options = options
  this.loose = !!options.loose

  var m = version.trim().match(options.loose ? re[t.LOOSE] : re[t.FULL])

  if (!m) {
    throw new TypeError('Invalid Version: ' + version)
  }

  this.raw = version

  // these are actually numbers
  this.major = +m[1]
  this.minor = +m[2]
  this.patch = +m[3]

  if (this.major > MAX_SAFE_INTEGER || this.major < 0) {
    throw new TypeError('Invalid major version')
  }

  if (this.minor > MAX_SAFE_INTEGER || this.minor < 0) {
    throw new TypeError('Invalid minor version')
  }

  if (this.patch > MAX_SAFE_INTEGER || this.patch < 0) {
    throw new TypeError('Invalid patch version')
  }

  // numberify any prerelease numeric ids
  if (!m[4]) {
    this.prerelease = []
  } else {
    this.prerelease = m[4].split('.').map(function (id) {
      if (/^[0-9]+$/.test(id)) {
        var num = +id
        if (num >= 0 && num < MAX_SAFE_INTEGER) {
          return num
        }
      }
      return id
    })
  }

  this.build = m[5] ? m[5].split('.') : []
  this.format()
}

SemVer.prototype.format = function () {
  this.version = this.major + '.' + this.minor + '.' + this.patch
  if (this.prerelease.length) {
    this.version += '-' + this.prerelease.join('.')
  }
  return this.version
}

SemVer.prototype.toString = function () {
  return this.version
}

SemVer.prototype.compare = function (other) {
  debug('SemVer.compare', this.version, this.options, other)
  if (!(other instanceof SemVer)) {
    other = new SemVer(other, this.options)
  }

  return this.compareMain(other) || this.comparePre(other)
}

SemVer.prototype.compareMain = function (other) {
  if (!(other instanceof SemVer)) {
    other = new SemVer(other, this.options)
  }

  return compareIdentifiers(this.major, other.major) ||
         compareIdentifiers(this.minor, other.minor) ||
         compareIdentifiers(this.patch, other.patch)
}

SemVer.prototype.comparePre = function (other) {
  if (!(other instanceof SemVer)) {
    other = new SemVer(other, this.options)
  }

  // NOT having a prerelease is > having one
  if (this.prerelease.length && !other.prerelease.length) {
    return -1
  } else if (!this.prerelease.length && other.prerelease.length) {
    return 1
  } else if (!this.prerelease.length && !other.prerelease.length) {
    return 0
  }

  var i = 0
  do {
    var a = this.prerelease[i]
    var b = other.prerelease[i]
    debug('prerelease compare', i, a, b)
    if (a === undefined && b === undefined) {
      return 0
    } else if (b === undefined) {
      return 1
    } else if (a === undefined) {
      return -1
    } else if (a === b) {
      continue
    } else {
      return compareIdentifiers(a, b)
    }
  } while (++i)
}

SemVer.prototype.compareBuild = function (other) {
  if (!(other instanceof SemVer)) {
    other = new SemVer(other, this.options)
  }

  var i = 0
  do {
    var a = this.build[i]
    var b = other.build[i]
    debug('prerelease compare', i, a, b)
    if (a === undefined && b === undefined) {
      return 0
    } else if (b === undefined) {
      return 1
    } else if (a === undefined) {
      return -1
    } else if (a === b) {
      continue
    } else {
      return compareIdentifiers(a, b)
    }
  } while (++i)
}

// preminor will bump the version up to the next minor release, and immediately
// down to pre-release. premajor and prepatch work the same way.
SemVer.prototype.inc = function (release, identifier) {
  switch (release) {
    case 'premajor':
      this.prerelease.length = 0
      this.patch = 0
      this.minor = 0
      this.major++
      this.inc('pre', identifier)
      break
    case 'preminor':
      this.prerelease.length = 0
      this.patch = 0
      this.minor++
      this.inc('pre', identifier)
      break
    case 'prepatch':
      // If this is already a prerelease, it will bump to the next version
      // drop any prereleases that might already exist, since they are not
      // relevant at this point.
      this.prerelease.length = 0
      this.inc('patch', identifier)
      this.inc('pre', identifier)
      break
    // If the input is a non-prerelease version, this acts the same as
    // prepatch.
    case 'prerelease':
      if (this.prerelease.length === 0) {
        this.inc('patch', identifier)
      }
      this.inc('pre', identifier)
      break

    case 'major':
      // If this is a pre-major version, bump up to the same major version.
      // Otherwise increment major.
      // 1.0.0-5 bumps to 1.0.0
      // 1.1.0 bumps to 2.0.0
      if (this.minor !== 0 ||
          this.patch !== 0 ||
          this.prerelease.length === 0) {
        this.major++
      }
      this.minor = 0
      this.patch = 0
      this.prerelease = []
      break
    case 'minor':
      // If this is a pre-minor version, bump up to the same minor version.
      // Otherwise increment minor.
      // 1.2.0-5 bumps to 1.2.0
      // 1.2.1 bumps to 1.3.0
      if (this.patch !== 0 || this.prerelease.length === 0) {
        this.minor++
      }
      this.patch = 0
      this.prerelease = []
      break
    case 'patch':
      // If this is not a pre-release version, it will increment the patch.
      // If it is a pre-release it will bump up to the same patch version.
      // 1.2.0-5 patches to 1.2.0
      // 1.2.0 patches to 1.2.1
      if (this.prerelease.length === 0) {
        this.patch++
      }
      this.prerelease = []
      break
    // This probably shouldn't be used publicly.
    // 1.0.0 "pre" would become 1.0.0-0 which is the wrong direction.
    case 'pre':
      if (this.prerelease.length === 0) {
        this.prerelease = [0]
      } else {
        var i = this.prerelease.length
        while (--i >= 0) {
          if (typeof this.prerelease[i] === 'number') {
            this.prerelease[i]++
            i = -2
          }
        }
        if (i === -1) {
          // didn't increment anything
          this.prerelease.push(0)
        }
      }
      if (identifier) {
        // 1.2.0-beta.1 bumps to 1.2.0-beta.2,
        // 1.2.0-beta.fooblz or 1.2.0-beta bumps to 1.2.0-beta.0
        if (this.prerelease[0] === identifier) {
          if (isNaN(this.prerelease[1])) {
            this.prerelease = [identifier, 0]
          }
        } else {
          this.prerelease = [identifier, 0]
        }
      }
      break

    default:
      throw new Error('invalid increment argument: ' + release)
  }
  this.format()
  this.raw = this.version
  return this
}

exports.inc = inc
function inc (version, release, loose, identifier) {
  if (typeof (loose) === 'string') {
    identifier = loose
    loose = undefined
  }

  try {
    return new SemVer(version, loose).inc(release, identifier).version
  } catch (er) {
    return null
  }
}

exports.diff = diff
function diff (version1, version2) {
  if (eq(version1, version2)) {
    return null
  } else {
    var v1 = parse(version1)
    var v2 = parse(version2)
    var prefix = ''
    if (v1.prerelease.length || v2.prerelease.length) {
      prefix = 'pre'
      var defaultResult = 'prerelease'
    }
    for (var key in v1) {
      if (key === 'major' || key === 'minor' || key === 'patch') {
        if (v1[key] !== v2[key]) {
          return prefix + key
        }
      }
    }
    return defaultResult // may be undefined
  }
}

exports.compareIdentifiers = compareIdentifiers

var numeric = /^[0-9]+$/
function compareIdentifiers (a, b) {
  var anum = numeric.test(a)
  var bnum = numeric.test(b)

  if (anum && bnum) {
    a = +a
    b = +b
  }

  return a === b ? 0
    : (anum && !bnum) ? -1
    : (bnum && !anum) ? 1
    : a < b ? -1
    : 1
}

exports.rcompareIdentifiers = rcompareIdentifiers
function rcompareIdentifiers (a, b) {
  return compareIdentifiers(b, a)
}

exports.major = major
function major (a, loose) {
  return new SemVer(a, loose).major
}

exports.minor = minor
function minor (a, loose) {
  return new SemVer(a, loose).minor
}

exports.patch = patch
function patch (a, loose) {
  return new SemVer(a, loose).patch
}

exports.compare = compare
function compare (a, b, loose) {
  return new SemVer(a, loose).compare(new SemVer(b, loose))
}

exports.compareLoose = compareLoose
function compareLoose (a, b) {
  return compare(a, b, true)
}

exports.compareBuild = compareBuild
function compareBuild (a, b, loose) {
  var versionA = new SemVer(a, loose)
  var versionB = new SemVer(b, loose)
  return versionA.compare(versionB) || versionA.compareBuild(versionB)
}

exports.rcompare = rcompare
function rcompare (a, b, loose) {
  return compare(b, a, loose)
}

exports.sort = sort
function sort (list, loose) {
  return list.sort(function (a, b) {
    return exports.compareBuild(a, b, loose)
  })
}

exports.rsort = rsort
function rsort (list, loose) {
  return list.sort(function (a, b) {
    return exports.compareBuild(b, a, loose)
  })
}

exports.gt = gt
function gt (a, b, loose) {
  return compare(a, b, loose) > 0
}

exports.lt = lt
function lt (a, b, loose) {
  return compare(a, b, loose) < 0
}

exports.eq = eq
function eq (a, b, loose) {
  return compare(a, b, loose) === 0
}

exports.neq = neq
function neq (a, b, loose) {
  return compare(a, b, loose) !== 0
}

exports.gte = gte
function gte (a, b, loose) {
  return compare(a, b, loose) >= 0
}

exports.lte = lte
function lte (a, b, loose) {
  return compare(a, b, loose) <= 0
}

exports.cmp = cmp
function cmp (a, op, b, loose) {
  switch (op) {
    case '===':
      if (typeof a === 'object')
        a = a.version
      if (typeof b === 'object')
        b = b.version
      return a === b

    case '!==':
      if (typeof a === 'object')
        a = a.version
      if (typeof b === 'object')
        b = b.version
      return a !== b

    case '':
    case '=':
    case '==':
      return eq(a, b, loose)

    case '!=':
      return neq(a, b, loose)

    case '>':
      return gt(a, b, loose)

    case '>=':
      return gte(a, b, loose)

    case '<':
      return lt(a, b, loose)

    case '<=':
      return lte(a, b, loose)

    default:
      throw new TypeError('Invalid operator: ' + op)
  }
}

exports.Comparator = Comparator
function Comparator (comp, options) {
  if (!options || typeof options !== 'object') {
    options = {
      loose: !!options,
      includePrerelease: false
    }
  }

  if (comp instanceof Comparator) {
    if (comp.loose === !!options.loose) {
      return comp
    } else {
      comp = comp.value
    }
  }

  if (!(this instanceof Comparator)) {
    return new Comparator(comp, options)
  }

  debug('comparator', comp, options)
  this.options = options
  this.loose = !!options.loose
  this.parse(comp)

  if (this.semver === ANY) {
    this.value = ''
  } else {
    this.value = this.operator + this.semver.version
  }

  debug('comp', this)
}

var ANY = {}
Comparator.prototype.parse = function (comp) {
  var r = this.options.loose ? re[t.COMPARATORLOOSE] : re[t.COMPARATOR]
  var m = comp.match(r)

  if (!m) {
    throw new TypeError('Invalid comparator: ' + comp)
  }

  this.operator = m[1] !== undefined ? m[1] : ''
  if (this.operator === '=') {
    this.operator = ''
  }

  // if it literally is just '>' or '' then allow anything.
  if (!m[2]) {
    this.semver = ANY
  } else {
    this.semver = new SemVer(m[2], this.options.loose)
  }
}

Comparator.prototype.toString = function () {
  return this.value
}

Comparator.prototype.test = function (version) {
  debug('Comparator.test', version, this.options.loose)

  if (this.semver === ANY || version === ANY) {
    return true
  }

  if (typeof version === 'string') {
    try {
      version = new SemVer(version, this.options)
    } catch (er) {
      return false
    }
  }

  return cmp(version, this.operator, this.semver, this.options)
}

Comparator.prototype.intersects = function (comp, options) {
  if (!(comp instanceof Comparator)) {
    throw new TypeError('a Comparator is required')
  }

  if (!options || typeof options !== 'object') {
    options = {
      loose: !!options,
      includePrerelease: false
    }
  }

  var rangeTmp

  if (this.operator === '') {
    if (this.value === '') {
      return true
    }
    rangeTmp = new Range(comp.value, options)
    return satisfies(this.value, rangeTmp, options)
  } else if (comp.operator === '') {
    if (comp.value === '') {
      return true
    }
    rangeTmp = new Range(this.value, options)
    return satisfies(comp.semver, rangeTmp, options)
  }

  var sameDirectionIncreasing =
    (this.operator === '>=' || this.operator === '>') &&
    (comp.operator === '>=' || comp.operator === '>')
  var sameDirectionDecreasing =
    (this.operator === '<=' || this.operator === '<') &&
    (comp.operator === '<=' || comp.operator === '<')
  var sameSemVer = this.semver.version === comp.semver.version
  var differentDirectionsInclusive =
    (this.operator === '>=' || this.operator === '<=') &&
    (comp.operator === '>=' || comp.operator === '<=')
  var oppositeDirectionsLessThan =
    cmp(this.semver, '<', comp.semver, options) &&
    ((this.operator === '>=' || this.operator === '>') &&
    (comp.operator === '<=' || comp.operator === '<'))
  var oppositeDirectionsGreaterThan =
    cmp(this.semver, '>', comp.semver, options) &&
    ((this.operator === '<=' || this.operator === '<') &&
    (comp.operator === '>=' || comp.operator === '>'))

  return sameDirectionIncreasing || sameDirectionDecreasing ||
    (sameSemVer && differentDirectionsInclusive) ||
    oppositeDirectionsLessThan || oppositeDirectionsGreaterThan
}

exports.Range = Range
function Range (range, options) {
  if (!options || typeof options !== 'object') {
    options = {
      loose: !!options,
      includePrerelease: false
    }
  }

  if (range instanceof Range) {
    if (range.loose === !!options.loose &&
        range.includePrerelease === !!options.includePrerelease) {
      return range
    } else {
      return new Range(range.raw, options)
    }
  }

  if (range instanceof Comparator) {
    return new Range(range.value, options)
  }

  if (!(this instanceof Range)) {
    return new Range(range, options)
  }

  this.options = options
  this.loose = !!options.loose
  this.includePrerelease = !!options.includePrerelease

  // First, split based on boolean or ||
  this.raw = range
  this.set = range.split(/\s*\|\|\s*/).map(function (range) {
    return this.parseRange(range.trim())
  }, this).filter(function (c) {
    // throw out any that are not relevant for whatever reason
    return c.length
  })

  if (!this.set.length) {
    throw new TypeError('Invalid SemVer Range: ' + range)
  }

  this.format()
}

Range.prototype.format = function () {
  this.range = this.set.map(function (comps) {
    return comps.join(' ').trim()
  }).join('||').trim()
  return this.range
}

Range.prototype.toString = function () {
  return this.range
}

Range.prototype.parseRange = function (range) {
  var loose = this.options.loose
  range = range.trim()
  // `1.2.3 - 1.2.4` => `>=1.2.3 <=1.2.4`
  var hr = loose ? re[t.HYPHENRANGELOOSE] : re[t.HYPHENRANGE]
  range = range.replace(hr, hyphenReplace)
  debug('hyphen replace', range)
  // `> 1.2.3 < 1.2.5` => `>1.2.3 <1.2.5`
  range = range.replace(re[t.COMPARATORTRIM], comparatorTrimReplace)
  debug('comparator trim', range, re[t.COMPARATORTRIM])

  // `~ 1.2.3` => `~1.2.3`
  range = range.replace(re[t.TILDETRIM], tildeTrimReplace)

  // `^ 1.2.3` => `^1.2.3`
  range = range.replace(re[t.CARETTRIM], caretTrimReplace)

  // normalize spaces
  range = range.split(/\s+/).join(' ')

  // At this point, the range is completely trimmed and
  // ready to be split into comparators.

  var compRe = loose ? re[t.COMPARATORLOOSE] : re[t.COMPARATOR]
  var set = range.split(' ').map(function (comp) {
    return parseComparator(comp, this.options)
  }, this).join(' ').split(/\s+/)
  if (this.options.loose) {
    // in loose mode, throw out any that are not valid comparators
    set = set.filter(function (comp) {
      return !!comp.match(compRe)
    })
  }
  set = set.map(function (comp) {
    return new Comparator(comp, this.options)
  }, this)

  return set
}

Range.prototype.intersects = function (range, options) {
  if (!(range instanceof Range)) {
    throw new TypeError('a Range is required')
  }

  return this.set.some(function (thisComparators) {
    return (
      isSatisfiable(thisComparators, options) &&
      range.set.some(function (rangeComparators) {
        return (
          isSatisfiable(rangeComparators, options) &&
          thisComparators.every(function (thisComparator) {
            return rangeComparators.every(function (rangeComparator) {
              return thisComparator.intersects(rangeComparator, options)
            })
          })
        )
      })
    )
  })
}

// take a set of comparators and determine whether there
// exists a version which can satisfy it
function isSatisfiable (comparators, options) {
  var result = true
  var remainingComparators = comparators.slice()
  var testComparator = remainingComparators.pop()

  while (result && remainingComparators.length) {
    result = remainingComparators.every(function (otherComparator) {
      return testComparator.intersects(otherComparator, options)
    })

    testComparator = remainingComparators.pop()
  }

  return result
}

// Mostly just for testing and legacy API reasons
exports.toComparators = toComparators
function toComparators (range, options) {
  return new Range(range, options).set.map(function (comp) {
    return comp.map(function (c) {
      return c.value
    }).join(' ').trim().split(' ')
  })
}

// comprised of xranges, tildes, stars, and gtlt's at this point.
// already replaced the hyphen ranges
// turn into a set of JUST comparators.
function parseComparator (comp, options) {
  debug('comp', comp, options)
  comp = replaceCarets(comp, options)
  debug('caret', comp)
  comp = replaceTildes(comp, options)
  debug('tildes', comp)
  comp = replaceXRanges(comp, options)
  debug('xrange', comp)
  comp = replaceStars(comp, options)
  debug('stars', comp)
  return comp
}

function isX (id) {
  return !id || id.toLowerCase() === 'x' || id === '*'
}

// ~, ~> --> * (any, kinda silly)
// ~2, ~2.x, ~2.x.x, ~>2, ~>2.x ~>2.x.x --> >=2.0.0 <3.0.0
// ~2.0, ~2.0.x, ~>2.0, ~>2.0.x --> >=2.0.0 <2.1.0
// ~1.2, ~1.2.x, ~>1.2, ~>1.2.x --> >=1.2.0 <1.3.0
// ~1.2.3, ~>1.2.3 --> >=1.2.3 <1.3.0
// ~1.2.0, ~>1.2.0 --> >=1.2.0 <1.3.0
function replaceTildes (comp, options) {
  return comp.trim().split(/\s+/).map(function (comp) {
    return replaceTilde(comp, options)
  }).join(' ')
}

function replaceTilde (comp, options) {
  var r = options.loose ? re[t.TILDELOOSE] : re[t.TILDE]
  return comp.replace(r, function (_, M, m, p, pr) {
    debug('tilde', comp, _, M, m, p, pr)
    var ret

    if (isX(M)) {
      ret = ''
    } else if (isX(m)) {
      ret = '>=' + M + '.0.0 <' + (+M + 1) + '.0.0'
    } else if (isX(p)) {
      // ~1.2 == >=1.2.0 <1.3.0
      ret = '>=' + M + '.' + m + '.0 <' + M + '.' + (+m + 1) + '.0'
    } else if (pr) {
      debug('replaceTilde pr', pr)
      ret = '>=' + M + '.' + m + '.' + p + '-' + pr +
            ' <' + M + '.' + (+m + 1) + '.0'
    } else {
      // ~1.2.3 == >=1.2.3 <1.3.0
      ret = '>=' + M + '.' + m + '.' + p +
            ' <' + M + '.' + (+m + 1) + '.0'
    }

    debug('tilde return', ret)
    return ret
  })
}

// ^ --> * (any, kinda silly)
// ^2, ^2.x, ^2.x.x --> >=2.0.0 <3.0.0
// ^2.0, ^2.0.x --> >=2.0.0 <3.0.0
// ^1.2, ^1.2.x --> >=1.2.0 <2.0.0
// ^1.2.3 --> >=1.2.3 <2.0.0
// ^1.2.0 --> >=1.2.0 <2.0.0
function replaceCarets (comp, options) {
  return comp.trim().split(/\s+/).map(function (comp) {
    return replaceCaret(comp, options)
  }).join(' ')
}

function replaceCaret (comp, options) {
  debug('caret', comp, options)
  var r = options.loose ? re[t.CARETLOOSE] : re[t.CARET]
  return comp.replace(r, function (_, M, m, p, pr) {
    debug('caret', comp, _, M, m, p, pr)
    var ret

    if (isX(M)) {
      ret = ''
    } else if (isX(m)) {
      ret = '>=' + M + '.0.0 <' + (+M + 1) + '.0.0'
    } else if (isX(p)) {
      if (M === '0') {
        ret = '>=' + M + '.' + m + '.0 <' + M + '.' + (+m + 1) + '.0'
      } else {
        ret = '>=' + M + '.' + m + '.0 <' + (+M + 1) + '.0.0'
      }
    } else if (pr) {
      debug('replaceCaret pr', pr)
      if (M === '0') {
        if (m === '0') {
          ret = '>=' + M + '.' + m + '.' + p + '-' + pr +
                ' <' + M + '.' + m + '.' + (+p + 1)
        } else {
          ret = '>=' + M + '.' + m + '.' + p + '-' + pr +
                ' <' + M + '.' + (+m + 1) + '.0'
        }
      } else {
        ret = '>=' + M + '.' + m + '.' + p + '-' + pr +
              ' <' + (+M + 1) + '.0.0'
      }
    } else {
      debug('no pr')
      if (M === '0') {
        if (m === '0') {
          ret = '>=' + M + '.' + m + '.' + p +
                ' <' + M + '.' + m + '.' + (+p + 1)
        } else {
          ret = '>=' + M + '.' + m + '.' + p +
                ' <' + M + '.' + (+m + 1) + '.0'
        }
      } else {
        ret = '>=' + M + '.' + m + '.' + p +
              ' <' + (+M + 1) + '.0.0'
      }
    }

    debug('caret return', ret)
    return ret
  })
}

function replaceXRanges (comp, options) {
  debug('replaceXRanges', comp, options)
  return comp.split(/\s+/).map(function (comp) {
    return replaceXRange(comp, options)
  }).join(' ')
}

function replaceXRange (comp, options) {
  comp = comp.trim()
  var r = options.loose ? re[t.XRANGELOOSE] : re[t.XRANGE]
  return comp.replace(r, function (ret, gtlt, M, m, p, pr) {
    debug('xRange', comp, ret, gtlt, M, m, p, pr)
    var xM = isX(M)
    var xm = xM || isX(m)
    var xp = xm || isX(p)
    var anyX = xp

    if (gtlt === '=' && anyX) {
      gtlt = ''
    }

    // if we're including prereleases in the match, then we need
    // to fix this to -0, the lowest possible prerelease value
    pr = options.includePrerelease ? '-0' : ''

    if (xM) {
      if (gtlt === '>' || gtlt === '<') {
        // nothing is allowed
        ret = '<0.0.0-0'
      } else {
        // nothing is forbidden
        ret = '*'
      }
    } else if (gtlt && anyX) {
      // we know patch is an x, because we have any x at all.
      // replace X with 0
      if (xm) {
        m = 0
      }
      p = 0

      if (gtlt === '>') {
        // >1 => >=2.0.0
        // >1.2 => >=1.3.0
        // >1.2.3 => >= 1.2.4
        gtlt = '>='
        if (xm) {
          M = +M + 1
          m = 0
          p = 0
        } else {
          m = +m + 1
          p = 0
        }
      } else if (gtlt === '<=') {
        // <=0.7.x is actually <0.8.0, since any 0.7.x should
        // pass.  Similarly, <=7.x is actually <8.0.0, etc.
        gtlt = '<'
        if (xm) {
          M = +M + 1
        } else {
          m = +m + 1
        }
      }

      ret = gtlt + M + '.' + m + '.' + p + pr
    } else if (xm) {
      ret = '>=' + M + '.0.0' + pr + ' <' + (+M + 1) + '.0.0' + pr
    } else if (xp) {
      ret = '>=' + M + '.' + m + '.0' + pr +
        ' <' + M + '.' + (+m + 1) + '.0' + pr
    }

    debug('xRange return', ret)

    return ret
  })
}

// Because * is AND-ed with everything else in the comparator,
// and '' means "any version", just remove the *s entirely.
function replaceStars (comp, options) {
  debug('replaceStars', comp, options)
  // Looseness is ignored here.  star is always as loose as it gets!
  return comp.trim().replace(re[t.STAR], '')
}

// This function is passed to string.replace(re[t.HYPHENRANGE])
// M, m, patch, prerelease, build
// 1.2 - 3.4.5 => >=1.2.0 <=3.4.5
// 1.2.3 - 3.4 => >=1.2.0 <3.5.0 Any 3.4.x will do
// 1.2 - 3.4 => >=1.2.0 <3.5.0
function hyphenReplace ($0,
  from, fM, fm, fp, fpr, fb,
  to, tM, tm, tp, tpr, tb) {
  if (isX(fM)) {
    from = ''
  } else if (isX(fm)) {
    from = '>=' + fM + '.0.0'
  } else if (isX(fp)) {
    from = '>=' + fM + '.' + fm + '.0'
  } else {
    from = '>=' + from
  }

  if (isX(tM)) {
    to = ''
  } else if (isX(tm)) {
    to = '<' + (+tM + 1) + '.0.0'
  } else if (isX(tp)) {
    to = '<' + tM + '.' + (+tm + 1) + '.0'
  } else if (tpr) {
    to = '<=' + tM + '.' + tm + '.' + tp + '-' + tpr
  } else {
    to = '<=' + to
  }

  return (from + ' ' + to).trim()
}

// if ANY of the sets match ALL of its comparators, then pass
Range.prototype.test = function (version) {
  if (!version) {
    return false
  }

  if (typeof version === 'string') {
    try {
      version = new SemVer(version, this.options)
    } catch (er) {
      return false
    }
  }

  for (var i = 0; i < this.set.length; i++) {
    if (testSet(this.set[i], version, this.options)) {
      return true
    }
  }
  return false
}

function testSet (set, version, options) {
  for (var i = 0; i < set.length; i++) {
    if (!set[i].test(version)) {
      return false
    }
  }

  if (version.prerelease.length && !options.includePrerelease) {
    // Find the set of versions that are allowed to have prereleases
    // For example, ^1.2.3-pr.1 desugars to >=1.2.3-pr.1 <2.0.0
    // That should allow `1.2.3-pr.2` to pass.
    // However, `1.2.4-alpha.notready` should NOT be allowed,
    // even though it's within the range set by the comparators.
    for (i = 0; i < set.length; i++) {
      debug(set[i].semver)
      if (set[i].semver === ANY) {
        continue
      }

      if (set[i].semver.prerelease.length > 0) {
        var allowed = set[i].semver
        if (allowed.major === version.major &&
            allowed.minor === version.minor &&
            allowed.patch === version.patch) {
          return true
        }
      }
    }

    // Version has a -pre, but it's not one of the ones we like.
    return false
  }

  return true
}

exports.satisfies = satisfies
function satisfies (version, range, options) {
  try {
    range = new Range(range, options)
  } catch (er) {
    return false
  }
  return range.test(version)
}

exports.maxSatisfying = maxSatisfying
function maxSatisfying (versions, range, options) {
  var max = null
  var maxSV = null
  try {
    var rangeObj = new Range(range, options)
  } catch (er) {
    return null
  }
  versions.forEach(function (v) {
    if (rangeObj.test(v)) {
      // satisfies(v, range, options)
      if (!max || maxSV.compare(v) === -1) {
        // compare(max, v, true)
        max = v
        maxSV = new SemVer(max, options)
      }
    }
  })
  return max
}

exports.minSatisfying = minSatisfying
function minSatisfying (versions, range, options) {
  var min = null
  var minSV = null
  try {
    var rangeObj = new Range(range, options)
  } catch (er) {
    return null
  }
  versions.forEach(function (v) {
    if (rangeObj.test(v)) {
      // satisfies(v, range, options)
      if (!min || minSV.compare(v) === 1) {
        // compare(min, v, true)
        min = v
        minSV = new SemVer(min, options)
      }
    }
  })
  return min
}

exports.minVersion = minVersion
function minVersion (range, loose) {
  range = new Range(range, loose)

  var minver = new SemVer('0.0.0')
  if (range.test(minver)) {
    return minver
  }

  minver = new SemVer('0.0.0-0')
  if (range.test(minver)) {
    return minver
  }

  minver = null
  for (var i = 0; i < range.set.length; ++i) {
    var comparators = range.set[i]

    comparators.forEach(function (comparator) {
      // Clone to avoid manipulating the comparator's semver object.
      var compver = new SemVer(comparator.semver.version)
      switch (comparator.operator) {
        case '>':
          if (compver.prerelease.length === 0) {
            compver.patch++
          } else {
            compver.prerelease.push(0)
          }
          compver.raw = compver.format()
          /* fallthrough */
        case '':
        case '>=':
          if (!minver || gt(minver, compver)) {
            minver = compver
          }
          break
        case '<':
        case '<=':
          /* Ignore maximum versions */
          break
        /* istanbul ignore next */
        default:
          throw new Error('Unexpected operation: ' + comparator.operator)
      }
    })
  }

  if (minver && range.test(minver)) {
    return minver
  }

  return null
}

exports.validRange = validRange
function validRange (range, options) {
  try {
    // Return '*' instead of '' so that truthiness works.
    // This will throw if it's invalid anyway
    return new Range(range, options).range || '*'
  } catch (er) {
    return null
  }
}

// Determine if version is less than all the versions possible in the range
exports.ltr = ltr
function ltr (version, range, options) {
  return outside(version, range, '<', options)
}

// Determine if version is greater than all the versions possible in the range.
exports.gtr = gtr
function gtr (version, range, options) {
  return outside(version, range, '>', options)
}

exports.outside = outside
function outside (version, range, hilo, options) {
  version = new SemVer(version, options)
  range = new Range(range, options)

  var gtfn, ltefn, ltfn, comp, ecomp
  switch (hilo) {
    case '>':
      gtfn = gt
      ltefn = lte
      ltfn = lt
      comp = '>'
      ecomp = '>='
      break
    case '<':
      gtfn = lt
      ltefn = gte
      ltfn = gt
      comp = '<'
      ecomp = '<='
      break
    default:
      throw new TypeError('Must provide a hilo val of "<" or ">"')
  }

  // If it satisifes the range it is not outside
  if (satisfies(version, range, options)) {
    return false
  }

  // From now on, variable terms are as if we're in "gtr" mode.
  // but note that everything is flipped for the "ltr" function.

  for (var i = 0; i < range.set.length; ++i) {
    var comparators = range.set[i]

    var high = null
    var low = null

    comparators.forEach(function (comparator) {
      if (comparator.semver === ANY) {
        comparator = new Comparator('>=0.0.0')
      }
      high = high || comparator
      low = low || comparator
      if (gtfn(comparator.semver, high.semver, options)) {
        high = comparator
      } else if (ltfn(comparator.semver, low.semver, options)) {
        low = comparator
      }
    })

    // If the edge version comparator has a operator then our version
    // isn't outside it
    if (high.operator === comp || high.operator === ecomp) {
      return false
    }

    // If the lowest version comparator has an operator and our version
    // is less than it then it isn't higher than the range
    if ((!low.operator || low.operator === comp) &&
        ltefn(version, low.semver)) {
      return false
    } else if (low.operator === ecomp && ltfn(version, low.semver)) {
      return false
    }
  }
  return true
}

exports.prerelease = prerelease
function prerelease (version, options) {
  var parsed = parse(version, options)
  return (parsed && parsed.prerelease.length) ? parsed.prerelease : null
}

exports.intersects = intersects
function intersects (r1, r2, options) {
  r1 = new Range(r1, options)
  r2 = new Range(r2, options)
  return r1.intersects(r2)
}

exports.coerce = coerce
function coerce (version, options) {
  if (version instanceof SemVer) {
    return version
  }

  if (typeof version === 'number') {
    version = String(version)
  }

  if (typeof version !== 'string') {
    return null
  }

  options = options || {}

  var match = null
  if (!options.rtl) {
    match = version.match(re[t.COERCE])
  } else {
    // Find the right-most coercible string that does not share
    // a terminus with a more left-ward coercible string.
    // Eg, '1.2.3.4' wants to coerce '2.3.4', not '3.4' or '4'
    //
    // Walk through the string checking with a /g regexp
    // Manually set the index so as to pick up overlapping matches.
    // Stop when we get a match that ends at the string end, since no
    // coercible string can be more right-ward without the same terminus.
    var next
    while ((next = re[t.COERCERTL].exec(version)) &&
      (!match || match.index + match[0].length !== version.length)
    ) {
      if (!match ||
          next.index + next[0].length !== match.index + match[0].length) {
        match = next
      }
      re[t.COERCERTL].lastIndex = next.index + next[1].length + next[2].length
    }
    // leave it in a clean state
    re[t.COERCERTL].lastIndex = -1
  }

  if (match === null) {
    return null
  }

  return parse(match[2] +
    '.' + (match[3] || '0') +
    '.' + (match[4] || '0'), options)
}


/***/ }),

/***/ 467:
/***/ ((module, exports, __webpack_require__) => {

"use strict";


Object.defineProperty(exports, "__esModule", ({ value: true }));

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var Stream = _interopDefault(__webpack_require__(2413));
var http = _interopDefault(__webpack_require__(8605));
var Url = _interopDefault(__webpack_require__(8835));
var https = _interopDefault(__webpack_require__(7211));
var zlib = _interopDefault(__webpack_require__(8761));

// Based on https://github.com/tmpvar/jsdom/blob/aa85b2abf07766ff7bf5c1f6daafb3726f2f2db5/lib/jsdom/living/blob.js

// fix for "Readable" isn't a named export issue
const Readable = Stream.Readable;

const BUFFER = Symbol('buffer');
const TYPE = Symbol('type');

class Blob {
	constructor() {
		this[TYPE] = '';

		const blobParts = arguments[0];
		const options = arguments[1];

		const buffers = [];
		let size = 0;

		if (blobParts) {
			const a = blobParts;
			const length = Number(a.length);
			for (let i = 0; i < length; i++) {
				const element = a[i];
				let buffer;
				if (element instanceof Buffer) {
					buffer = element;
				} else if (ArrayBuffer.isView(element)) {
					buffer = Buffer.from(element.buffer, element.byteOffset, element.byteLength);
				} else if (element instanceof ArrayBuffer) {
					buffer = Buffer.from(element);
				} else if (element instanceof Blob) {
					buffer = element[BUFFER];
				} else {
					buffer = Buffer.from(typeof element === 'string' ? element : String(element));
				}
				size += buffer.length;
				buffers.push(buffer);
			}
		}

		this[BUFFER] = Buffer.concat(buffers);

		let type = options && options.type !== undefined && String(options.type).toLowerCase();
		if (type && !/[^\u0020-\u007E]/.test(type)) {
			this[TYPE] = type;
		}
	}
	get size() {
		return this[BUFFER].length;
	}
	get type() {
		return this[TYPE];
	}
	text() {
		return Promise.resolve(this[BUFFER].toString());
	}
	arrayBuffer() {
		const buf = this[BUFFER];
		const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
		return Promise.resolve(ab);
	}
	stream() {
		const readable = new Readable();
		readable._read = function () {};
		readable.push(this[BUFFER]);
		readable.push(null);
		return readable;
	}
	toString() {
		return '[object Blob]';
	}
	slice() {
		const size = this.size;

		const start = arguments[0];
		const end = arguments[1];
		let relativeStart, relativeEnd;
		if (start === undefined) {
			relativeStart = 0;
		} else if (start < 0) {
			relativeStart = Math.max(size + start, 0);
		} else {
			relativeStart = Math.min(start, size);
		}
		if (end === undefined) {
			relativeEnd = size;
		} else if (end < 0) {
			relativeEnd = Math.max(size + end, 0);
		} else {
			relativeEnd = Math.min(end, size);
		}
		const span = Math.max(relativeEnd - relativeStart, 0);

		const buffer = this[BUFFER];
		const slicedBuffer = buffer.slice(relativeStart, relativeStart + span);
		const blob = new Blob([], { type: arguments[2] });
		blob[BUFFER] = slicedBuffer;
		return blob;
	}
}

Object.defineProperties(Blob.prototype, {
	size: { enumerable: true },
	type: { enumerable: true },
	slice: { enumerable: true }
});

Object.defineProperty(Blob.prototype, Symbol.toStringTag, {
	value: 'Blob',
	writable: false,
	enumerable: false,
	configurable: true
});

/**
 * fetch-error.js
 *
 * FetchError interface for operational errors
 */

/**
 * Create FetchError instance
 *
 * @param   String      message      Error message for human
 * @param   String      type         Error type for machine
 * @param   String      systemError  For Node.js system error
 * @return  FetchError
 */
function FetchError(message, type, systemError) {
  Error.call(this, message);

  this.message = message;
  this.type = type;

  // when err.type is `system`, err.code contains system error code
  if (systemError) {
    this.code = this.errno = systemError.code;
  }

  // hide custom error implementation details from end-users
  Error.captureStackTrace(this, this.constructor);
}

FetchError.prototype = Object.create(Error.prototype);
FetchError.prototype.constructor = FetchError;
FetchError.prototype.name = 'FetchError';

let convert;
try {
	convert = __webpack_require__(2877).convert;
} catch (e) {}

const INTERNALS = Symbol('Body internals');

// fix an issue where "PassThrough" isn't a named export for node <10
const PassThrough = Stream.PassThrough;

/**
 * Body mixin
 *
 * Ref: https://fetch.spec.whatwg.org/#body
 *
 * @param   Stream  body  Readable stream
 * @param   Object  opts  Response options
 * @return  Void
 */
function Body(body) {
	var _this = this;

	var _ref = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {},
	    _ref$size = _ref.size;

	let size = _ref$size === undefined ? 0 : _ref$size;
	var _ref$timeout = _ref.timeout;
	let timeout = _ref$timeout === undefined ? 0 : _ref$timeout;

	if (body == null) {
		// body is undefined or null
		body = null;
	} else if (isURLSearchParams(body)) {
		// body is a URLSearchParams
		body = Buffer.from(body.toString());
	} else if (isBlob(body)) ; else if (Buffer.isBuffer(body)) ; else if (Object.prototype.toString.call(body) === '[object ArrayBuffer]') {
		// body is ArrayBuffer
		body = Buffer.from(body);
	} else if (ArrayBuffer.isView(body)) {
		// body is ArrayBufferView
		body = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
	} else if (body instanceof Stream) ; else {
		// none of the above
		// coerce to string then buffer
		body = Buffer.from(String(body));
	}
	this[INTERNALS] = {
		body,
		disturbed: false,
		error: null
	};
	this.size = size;
	this.timeout = timeout;

	if (body instanceof Stream) {
		body.on('error', function (err) {
			const error = err.name === 'AbortError' ? err : new FetchError(`Invalid response body while trying to fetch ${_this.url}: ${err.message}`, 'system', err);
			_this[INTERNALS].error = error;
		});
	}
}

Body.prototype = {
	get body() {
		return this[INTERNALS].body;
	},

	get bodyUsed() {
		return this[INTERNALS].disturbed;
	},

	/**
  * Decode response as ArrayBuffer
  *
  * @return  Promise
  */
	arrayBuffer() {
		return consumeBody.call(this).then(function (buf) {
			return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
		});
	},

	/**
  * Return raw response as Blob
  *
  * @return Promise
  */
	blob() {
		let ct = this.headers && this.headers.get('content-type') || '';
		return consumeBody.call(this).then(function (buf) {
			return Object.assign(
			// Prevent copying
			new Blob([], {
				type: ct.toLowerCase()
			}), {
				[BUFFER]: buf
			});
		});
	},

	/**
  * Decode response as json
  *
  * @return  Promise
  */
	json() {
		var _this2 = this;

		return consumeBody.call(this).then(function (buffer) {
			try {
				return JSON.parse(buffer.toString());
			} catch (err) {
				return Body.Promise.reject(new FetchError(`invalid json response body at ${_this2.url} reason: ${err.message}`, 'invalid-json'));
			}
		});
	},

	/**
  * Decode response as text
  *
  * @return  Promise
  */
	text() {
		return consumeBody.call(this).then(function (buffer) {
			return buffer.toString();
		});
	},

	/**
  * Decode response as buffer (non-spec api)
  *
  * @return  Promise
  */
	buffer() {
		return consumeBody.call(this);
	},

	/**
  * Decode response as text, while automatically detecting the encoding and
  * trying to decode to UTF-8 (non-spec api)
  *
  * @return  Promise
  */
	textConverted() {
		var _this3 = this;

		return consumeBody.call(this).then(function (buffer) {
			return convertBody(buffer, _this3.headers);
		});
	}
};

// In browsers, all properties are enumerable.
Object.defineProperties(Body.prototype, {
	body: { enumerable: true },
	bodyUsed: { enumerable: true },
	arrayBuffer: { enumerable: true },
	blob: { enumerable: true },
	json: { enumerable: true },
	text: { enumerable: true }
});

Body.mixIn = function (proto) {
	for (const name of Object.getOwnPropertyNames(Body.prototype)) {
		// istanbul ignore else: future proof
		if (!(name in proto)) {
			const desc = Object.getOwnPropertyDescriptor(Body.prototype, name);
			Object.defineProperty(proto, name, desc);
		}
	}
};

/**
 * Consume and convert an entire Body to a Buffer.
 *
 * Ref: https://fetch.spec.whatwg.org/#concept-body-consume-body
 *
 * @return  Promise
 */
function consumeBody() {
	var _this4 = this;

	if (this[INTERNALS].disturbed) {
		return Body.Promise.reject(new TypeError(`body used already for: ${this.url}`));
	}

	this[INTERNALS].disturbed = true;

	if (this[INTERNALS].error) {
		return Body.Promise.reject(this[INTERNALS].error);
	}

	let body = this.body;

	// body is null
	if (body === null) {
		return Body.Promise.resolve(Buffer.alloc(0));
	}

	// body is blob
	if (isBlob(body)) {
		body = body.stream();
	}

	// body is buffer
	if (Buffer.isBuffer(body)) {
		return Body.Promise.resolve(body);
	}

	// istanbul ignore if: should never happen
	if (!(body instanceof Stream)) {
		return Body.Promise.resolve(Buffer.alloc(0));
	}

	// body is stream
	// get ready to actually consume the body
	let accum = [];
	let accumBytes = 0;
	let abort = false;

	return new Body.Promise(function (resolve, reject) {
		let resTimeout;

		// allow timeout on slow response body
		if (_this4.timeout) {
			resTimeout = setTimeout(function () {
				abort = true;
				reject(new FetchError(`Response timeout while trying to fetch ${_this4.url} (over ${_this4.timeout}ms)`, 'body-timeout'));
			}, _this4.timeout);
		}

		// handle stream errors
		body.on('error', function (err) {
			if (err.name === 'AbortError') {
				// if the request was aborted, reject with this Error
				abort = true;
				reject(err);
			} else {
				// other errors, such as incorrect content-encoding
				reject(new FetchError(`Invalid response body while trying to fetch ${_this4.url}: ${err.message}`, 'system', err));
			}
		});

		body.on('data', function (chunk) {
			if (abort || chunk === null) {
				return;
			}

			if (_this4.size && accumBytes + chunk.length > _this4.size) {
				abort = true;
				reject(new FetchError(`content size at ${_this4.url} over limit: ${_this4.size}`, 'max-size'));
				return;
			}

			accumBytes += chunk.length;
			accum.push(chunk);
		});

		body.on('end', function () {
			if (abort) {
				return;
			}

			clearTimeout(resTimeout);

			try {
				resolve(Buffer.concat(accum, accumBytes));
			} catch (err) {
				// handle streams that have accumulated too much data (issue #414)
				reject(new FetchError(`Could not create Buffer from response body for ${_this4.url}: ${err.message}`, 'system', err));
			}
		});
	});
}

/**
 * Detect buffer encoding and convert to target encoding
 * ref: http://www.w3.org/TR/2011/WD-html5-20110113/parsing.html#determining-the-character-encoding
 *
 * @param   Buffer  buffer    Incoming buffer
 * @param   String  encoding  Target encoding
 * @return  String
 */
function convertBody(buffer, headers) {
	if (typeof convert !== 'function') {
		throw new Error('The package `encoding` must be installed to use the textConverted() function');
	}

	const ct = headers.get('content-type');
	let charset = 'utf-8';
	let res, str;

	// header
	if (ct) {
		res = /charset=([^;]*)/i.exec(ct);
	}

	// no charset in content type, peek at response body for at most 1024 bytes
	str = buffer.slice(0, 1024).toString();

	// html5
	if (!res && str) {
		res = /<meta.+?charset=(['"])(.+?)\1/i.exec(str);
	}

	// html4
	if (!res && str) {
		res = /<meta[\s]+?http-equiv=(['"])content-type\1[\s]+?content=(['"])(.+?)\2/i.exec(str);

		if (res) {
			res = /charset=(.*)/i.exec(res.pop());
		}
	}

	// xml
	if (!res && str) {
		res = /<\?xml.+?encoding=(['"])(.+?)\1/i.exec(str);
	}

	// found charset
	if (res) {
		charset = res.pop();

		// prevent decode issues when sites use incorrect encoding
		// ref: https://hsivonen.fi/encoding-menu/
		if (charset === 'gb2312' || charset === 'gbk') {
			charset = 'gb18030';
		}
	}

	// turn raw buffers into a single utf-8 buffer
	return convert(buffer, 'UTF-8', charset).toString();
}

/**
 * Detect a URLSearchParams object
 * ref: https://github.com/bitinn/node-fetch/issues/296#issuecomment-307598143
 *
 * @param   Object  obj     Object to detect by type or brand
 * @return  String
 */
function isURLSearchParams(obj) {
	// Duck-typing as a necessary condition.
	if (typeof obj !== 'object' || typeof obj.append !== 'function' || typeof obj.delete !== 'function' || typeof obj.get !== 'function' || typeof obj.getAll !== 'function' || typeof obj.has !== 'function' || typeof obj.set !== 'function') {
		return false;
	}

	// Brand-checking and more duck-typing as optional condition.
	return obj.constructor.name === 'URLSearchParams' || Object.prototype.toString.call(obj) === '[object URLSearchParams]' || typeof obj.sort === 'function';
}

/**
 * Check if `obj` is a W3C `Blob` object (which `File` inherits from)
 * @param  {*} obj
 * @return {boolean}
 */
function isBlob(obj) {
	return typeof obj === 'object' && typeof obj.arrayBuffer === 'function' && typeof obj.type === 'string' && typeof obj.stream === 'function' && typeof obj.constructor === 'function' && typeof obj.constructor.name === 'string' && /^(Blob|File)$/.test(obj.constructor.name) && /^(Blob|File)$/.test(obj[Symbol.toStringTag]);
}

/**
 * Clone body given Res/Req instance
 *
 * @param   Mixed  instance  Response or Request instance
 * @return  Mixed
 */
function clone(instance) {
	let p1, p2;
	let body = instance.body;

	// don't allow cloning a used body
	if (instance.bodyUsed) {
		throw new Error('cannot clone body after it is used');
	}

	// check that body is a stream and not form-data object
	// note: we can't clone the form-data object without having it as a dependency
	if (body instanceof Stream && typeof body.getBoundary !== 'function') {
		// tee instance body
		p1 = new PassThrough();
		p2 = new PassThrough();
		body.pipe(p1);
		body.pipe(p2);
		// set instance body to teed body and return the other teed body
		instance[INTERNALS].body = p1;
		body = p2;
	}

	return body;
}

/**
 * Performs the operation "extract a `Content-Type` value from |object|" as
 * specified in the specification:
 * https://fetch.spec.whatwg.org/#concept-bodyinit-extract
 *
 * This function assumes that instance.body is present.
 *
 * @param   Mixed  instance  Any options.body input
 */
function extractContentType(body) {
	if (body === null) {
		// body is null
		return null;
	} else if (typeof body === 'string') {
		// body is string
		return 'text/plain;charset=UTF-8';
	} else if (isURLSearchParams(body)) {
		// body is a URLSearchParams
		return 'application/x-www-form-urlencoded;charset=UTF-8';
	} else if (isBlob(body)) {
		// body is blob
		return body.type || null;
	} else if (Buffer.isBuffer(body)) {
		// body is buffer
		return null;
	} else if (Object.prototype.toString.call(body) === '[object ArrayBuffer]') {
		// body is ArrayBuffer
		return null;
	} else if (ArrayBuffer.isView(body)) {
		// body is ArrayBufferView
		return null;
	} else if (typeof body.getBoundary === 'function') {
		// detect form data input from form-data module
		return `multipart/form-data;boundary=${body.getBoundary()}`;
	} else if (body instanceof Stream) {
		// body is stream
		// can't really do much about this
		return null;
	} else {
		// Body constructor defaults other things to string
		return 'text/plain;charset=UTF-8';
	}
}

/**
 * The Fetch Standard treats this as if "total bytes" is a property on the body.
 * For us, we have to explicitly get it with a function.
 *
 * ref: https://fetch.spec.whatwg.org/#concept-body-total-bytes
 *
 * @param   Body    instance   Instance of Body
 * @return  Number?            Number of bytes, or null if not possible
 */
function getTotalBytes(instance) {
	const body = instance.body;


	if (body === null) {
		// body is null
		return 0;
	} else if (isBlob(body)) {
		return body.size;
	} else if (Buffer.isBuffer(body)) {
		// body is buffer
		return body.length;
	} else if (body && typeof body.getLengthSync === 'function') {
		// detect form data input from form-data module
		if (body._lengthRetrievers && body._lengthRetrievers.length == 0 || // 1.x
		body.hasKnownLength && body.hasKnownLength()) {
			// 2.x
			return body.getLengthSync();
		}
		return null;
	} else {
		// body is stream
		return null;
	}
}

/**
 * Write a Body to a Node.js WritableStream (e.g. http.Request) object.
 *
 * @param   Body    instance   Instance of Body
 * @return  Void
 */
function writeToStream(dest, instance) {
	const body = instance.body;


	if (body === null) {
		// body is null
		dest.end();
	} else if (isBlob(body)) {
		body.stream().pipe(dest);
	} else if (Buffer.isBuffer(body)) {
		// body is buffer
		dest.write(body);
		dest.end();
	} else {
		// body is stream
		body.pipe(dest);
	}
}

// expose Promise
Body.Promise = global.Promise;

/**
 * headers.js
 *
 * Headers class offers convenient helpers
 */

const invalidTokenRegex = /[^\^_`a-zA-Z\-0-9!#$%&'*+.|~]/;
const invalidHeaderCharRegex = /[^\t\x20-\x7e\x80-\xff]/;

function validateName(name) {
	name = `${name}`;
	if (invalidTokenRegex.test(name) || name === '') {
		throw new TypeError(`${name} is not a legal HTTP header name`);
	}
}

function validateValue(value) {
	value = `${value}`;
	if (invalidHeaderCharRegex.test(value)) {
		throw new TypeError(`${value} is not a legal HTTP header value`);
	}
}

/**
 * Find the key in the map object given a header name.
 *
 * Returns undefined if not found.
 *
 * @param   String  name  Header name
 * @return  String|Undefined
 */
function find(map, name) {
	name = name.toLowerCase();
	for (const key in map) {
		if (key.toLowerCase() === name) {
			return key;
		}
	}
	return undefined;
}

const MAP = Symbol('map');
class Headers {
	/**
  * Headers class
  *
  * @param   Object  headers  Response headers
  * @return  Void
  */
	constructor() {
		let init = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : undefined;

		this[MAP] = Object.create(null);

		if (init instanceof Headers) {
			const rawHeaders = init.raw();
			const headerNames = Object.keys(rawHeaders);

			for (const headerName of headerNames) {
				for (const value of rawHeaders[headerName]) {
					this.append(headerName, value);
				}
			}

			return;
		}

		// We don't worry about converting prop to ByteString here as append()
		// will handle it.
		if (init == null) ; else if (typeof init === 'object') {
			const method = init[Symbol.iterator];
			if (method != null) {
				if (typeof method !== 'function') {
					throw new TypeError('Header pairs must be iterable');
				}

				// sequence<sequence<ByteString>>
				// Note: per spec we have to first exhaust the lists then process them
				const pairs = [];
				for (const pair of init) {
					if (typeof pair !== 'object' || typeof pair[Symbol.iterator] !== 'function') {
						throw new TypeError('Each header pair must be iterable');
					}
					pairs.push(Array.from(pair));
				}

				for (const pair of pairs) {
					if (pair.length !== 2) {
						throw new TypeError('Each header pair must be a name/value tuple');
					}
					this.append(pair[0], pair[1]);
				}
			} else {
				// record<ByteString, ByteString>
				for (const key of Object.keys(init)) {
					const value = init[key];
					this.append(key, value);
				}
			}
		} else {
			throw new TypeError('Provided initializer must be an object');
		}
	}

	/**
  * Return combined header value given name
  *
  * @param   String  name  Header name
  * @return  Mixed
  */
	get(name) {
		name = `${name}`;
		validateName(name);
		const key = find(this[MAP], name);
		if (key === undefined) {
			return null;
		}

		return this[MAP][key].join(', ');
	}

	/**
  * Iterate over all headers
  *
  * @param   Function  callback  Executed for each item with parameters (value, name, thisArg)
  * @param   Boolean   thisArg   `this` context for callback function
  * @return  Void
  */
	forEach(callback) {
		let thisArg = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : undefined;

		let pairs = getHeaders(this);
		let i = 0;
		while (i < pairs.length) {
			var _pairs$i = pairs[i];
			const name = _pairs$i[0],
			      value = _pairs$i[1];

			callback.call(thisArg, value, name, this);
			pairs = getHeaders(this);
			i++;
		}
	}

	/**
  * Overwrite header values given name
  *
  * @param   String  name   Header name
  * @param   String  value  Header value
  * @return  Void
  */
	set(name, value) {
		name = `${name}`;
		value = `${value}`;
		validateName(name);
		validateValue(value);
		const key = find(this[MAP], name);
		this[MAP][key !== undefined ? key : name] = [value];
	}

	/**
  * Append a value onto existing header
  *
  * @param   String  name   Header name
  * @param   String  value  Header value
  * @return  Void
  */
	append(name, value) {
		name = `${name}`;
		value = `${value}`;
		validateName(name);
		validateValue(value);
		const key = find(this[MAP], name);
		if (key !== undefined) {
			this[MAP][key].push(value);
		} else {
			this[MAP][name] = [value];
		}
	}

	/**
  * Check for header name existence
  *
  * @param   String   name  Header name
  * @return  Boolean
  */
	has(name) {
		name = `${name}`;
		validateName(name);
		return find(this[MAP], name) !== undefined;
	}

	/**
  * Delete all header values given name
  *
  * @param   String  name  Header name
  * @return  Void
  */
	delete(name) {
		name = `${name}`;
		validateName(name);
		const key = find(this[MAP], name);
		if (key !== undefined) {
			delete this[MAP][key];
		}
	}

	/**
  * Return raw headers (non-spec api)
  *
  * @return  Object
  */
	raw() {
		return this[MAP];
	}

	/**
  * Get an iterator on keys.
  *
  * @return  Iterator
  */
	keys() {
		return createHeadersIterator(this, 'key');
	}

	/**
  * Get an iterator on values.
  *
  * @return  Iterator
  */
	values() {
		return createHeadersIterator(this, 'value');
	}

	/**
  * Get an iterator on entries.
  *
  * This is the default iterator of the Headers object.
  *
  * @return  Iterator
  */
	[Symbol.iterator]() {
		return createHeadersIterator(this, 'key+value');
	}
}
Headers.prototype.entries = Headers.prototype[Symbol.iterator];

Object.defineProperty(Headers.prototype, Symbol.toStringTag, {
	value: 'Headers',
	writable: false,
	enumerable: false,
	configurable: true
});

Object.defineProperties(Headers.prototype, {
	get: { enumerable: true },
	forEach: { enumerable: true },
	set: { enumerable: true },
	append: { enumerable: true },
	has: { enumerable: true },
	delete: { enumerable: true },
	keys: { enumerable: true },
	values: { enumerable: true },
	entries: { enumerable: true }
});

function getHeaders(headers) {
	let kind = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 'key+value';

	const keys = Object.keys(headers[MAP]).sort();
	return keys.map(kind === 'key' ? function (k) {
		return k.toLowerCase();
	} : kind === 'value' ? function (k) {
		return headers[MAP][k].join(', ');
	} : function (k) {
		return [k.toLowerCase(), headers[MAP][k].join(', ')];
	});
}

const INTERNAL = Symbol('internal');

function createHeadersIterator(target, kind) {
	const iterator = Object.create(HeadersIteratorPrototype);
	iterator[INTERNAL] = {
		target,
		kind,
		index: 0
	};
	return iterator;
}

const HeadersIteratorPrototype = Object.setPrototypeOf({
	next() {
		// istanbul ignore if
		if (!this || Object.getPrototypeOf(this) !== HeadersIteratorPrototype) {
			throw new TypeError('Value of `this` is not a HeadersIterator');
		}

		var _INTERNAL = this[INTERNAL];
		const target = _INTERNAL.target,
		      kind = _INTERNAL.kind,
		      index = _INTERNAL.index;

		const values = getHeaders(target, kind);
		const len = values.length;
		if (index >= len) {
			return {
				value: undefined,
				done: true
			};
		}

		this[INTERNAL].index = index + 1;

		return {
			value: values[index],
			done: false
		};
	}
}, Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())));

Object.defineProperty(HeadersIteratorPrototype, Symbol.toStringTag, {
	value: 'HeadersIterator',
	writable: false,
	enumerable: false,
	configurable: true
});

/**
 * Export the Headers object in a form that Node.js can consume.
 *
 * @param   Headers  headers
 * @return  Object
 */
function exportNodeCompatibleHeaders(headers) {
	const obj = Object.assign({ __proto__: null }, headers[MAP]);

	// http.request() only supports string as Host header. This hack makes
	// specifying custom Host header possible.
	const hostHeaderKey = find(headers[MAP], 'Host');
	if (hostHeaderKey !== undefined) {
		obj[hostHeaderKey] = obj[hostHeaderKey][0];
	}

	return obj;
}

/**
 * Create a Headers object from an object of headers, ignoring those that do
 * not conform to HTTP grammar productions.
 *
 * @param   Object  obj  Object of headers
 * @return  Headers
 */
function createHeadersLenient(obj) {
	const headers = new Headers();
	for (const name of Object.keys(obj)) {
		if (invalidTokenRegex.test(name)) {
			continue;
		}
		if (Array.isArray(obj[name])) {
			for (const val of obj[name]) {
				if (invalidHeaderCharRegex.test(val)) {
					continue;
				}
				if (headers[MAP][name] === undefined) {
					headers[MAP][name] = [val];
				} else {
					headers[MAP][name].push(val);
				}
			}
		} else if (!invalidHeaderCharRegex.test(obj[name])) {
			headers[MAP][name] = [obj[name]];
		}
	}
	return headers;
}

const INTERNALS$1 = Symbol('Response internals');

// fix an issue where "STATUS_CODES" aren't a named export for node <10
const STATUS_CODES = http.STATUS_CODES;

/**
 * Response class
 *
 * @param   Stream  body  Readable stream
 * @param   Object  opts  Response options
 * @return  Void
 */
class Response {
	constructor() {
		let body = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
		let opts = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

		Body.call(this, body, opts);

		const status = opts.status || 200;
		const headers = new Headers(opts.headers);

		if (body != null && !headers.has('Content-Type')) {
			const contentType = extractContentType(body);
			if (contentType) {
				headers.append('Content-Type', contentType);
			}
		}

		this[INTERNALS$1] = {
			url: opts.url,
			status,
			statusText: opts.statusText || STATUS_CODES[status],
			headers,
			counter: opts.counter
		};
	}

	get url() {
		return this[INTERNALS$1].url || '';
	}

	get status() {
		return this[INTERNALS$1].status;
	}

	/**
  * Convenience property representing if the request ended normally
  */
	get ok() {
		return this[INTERNALS$1].status >= 200 && this[INTERNALS$1].status < 300;
	}

	get redirected() {
		return this[INTERNALS$1].counter > 0;
	}

	get statusText() {
		return this[INTERNALS$1].statusText;
	}

	get headers() {
		return this[INTERNALS$1].headers;
	}

	/**
  * Clone this response
  *
  * @return  Response
  */
	clone() {
		return new Response(clone(this), {
			url: this.url,
			status: this.status,
			statusText: this.statusText,
			headers: this.headers,
			ok: this.ok,
			redirected: this.redirected
		});
	}
}

Body.mixIn(Response.prototype);

Object.defineProperties(Response.prototype, {
	url: { enumerable: true },
	status: { enumerable: true },
	ok: { enumerable: true },
	redirected: { enumerable: true },
	statusText: { enumerable: true },
	headers: { enumerable: true },
	clone: { enumerable: true }
});

Object.defineProperty(Response.prototype, Symbol.toStringTag, {
	value: 'Response',
	writable: false,
	enumerable: false,
	configurable: true
});

const INTERNALS$2 = Symbol('Request internals');

// fix an issue where "format", "parse" aren't a named export for node <10
const parse_url = Url.parse;
const format_url = Url.format;

const streamDestructionSupported = 'destroy' in Stream.Readable.prototype;

/**
 * Check if a value is an instance of Request.
 *
 * @param   Mixed   input
 * @return  Boolean
 */
function isRequest(input) {
	return typeof input === 'object' && typeof input[INTERNALS$2] === 'object';
}

function isAbortSignal(signal) {
	const proto = signal && typeof signal === 'object' && Object.getPrototypeOf(signal);
	return !!(proto && proto.constructor.name === 'AbortSignal');
}

/**
 * Request class
 *
 * @param   Mixed   input  Url or Request instance
 * @param   Object  init   Custom options
 * @return  Void
 */
class Request {
	constructor(input) {
		let init = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

		let parsedURL;

		// normalize input
		if (!isRequest(input)) {
			if (input && input.href) {
				// in order to support Node.js' Url objects; though WHATWG's URL objects
				// will fall into this branch also (since their `toString()` will return
				// `href` property anyway)
				parsedURL = parse_url(input.href);
			} else {
				// coerce input to a string before attempting to parse
				parsedURL = parse_url(`${input}`);
			}
			input = {};
		} else {
			parsedURL = parse_url(input.url);
		}

		let method = init.method || input.method || 'GET';
		method = method.toUpperCase();

		if ((init.body != null || isRequest(input) && input.body !== null) && (method === 'GET' || method === 'HEAD')) {
			throw new TypeError('Request with GET/HEAD method cannot have body');
		}

		let inputBody = init.body != null ? init.body : isRequest(input) && input.body !== null ? clone(input) : null;

		Body.call(this, inputBody, {
			timeout: init.timeout || input.timeout || 0,
			size: init.size || input.size || 0
		});

		const headers = new Headers(init.headers || input.headers || {});

		if (inputBody != null && !headers.has('Content-Type')) {
			const contentType = extractContentType(inputBody);
			if (contentType) {
				headers.append('Content-Type', contentType);
			}
		}

		let signal = isRequest(input) ? input.signal : null;
		if ('signal' in init) signal = init.signal;

		if (signal != null && !isAbortSignal(signal)) {
			throw new TypeError('Expected signal to be an instanceof AbortSignal');
		}

		this[INTERNALS$2] = {
			method,
			redirect: init.redirect || input.redirect || 'follow',
			headers,
			parsedURL,
			signal
		};

		// node-fetch-only options
		this.follow = init.follow !== undefined ? init.follow : input.follow !== undefined ? input.follow : 20;
		this.compress = init.compress !== undefined ? init.compress : input.compress !== undefined ? input.compress : true;
		this.counter = init.counter || input.counter || 0;
		this.agent = init.agent || input.agent;
	}

	get method() {
		return this[INTERNALS$2].method;
	}

	get url() {
		return format_url(this[INTERNALS$2].parsedURL);
	}

	get headers() {
		return this[INTERNALS$2].headers;
	}

	get redirect() {
		return this[INTERNALS$2].redirect;
	}

	get signal() {
		return this[INTERNALS$2].signal;
	}

	/**
  * Clone this request
  *
  * @return  Request
  */
	clone() {
		return new Request(this);
	}
}

Body.mixIn(Request.prototype);

Object.defineProperty(Request.prototype, Symbol.toStringTag, {
	value: 'Request',
	writable: false,
	enumerable: false,
	configurable: true
});

Object.defineProperties(Request.prototype, {
	method: { enumerable: true },
	url: { enumerable: true },
	headers: { enumerable: true },
	redirect: { enumerable: true },
	clone: { enumerable: true },
	signal: { enumerable: true }
});

/**
 * Convert a Request to Node.js http request options.
 *
 * @param   Request  A Request instance
 * @return  Object   The options object to be passed to http.request
 */
function getNodeRequestOptions(request) {
	const parsedURL = request[INTERNALS$2].parsedURL;
	const headers = new Headers(request[INTERNALS$2].headers);

	// fetch step 1.3
	if (!headers.has('Accept')) {
		headers.set('Accept', '*/*');
	}

	// Basic fetch
	if (!parsedURL.protocol || !parsedURL.hostname) {
		throw new TypeError('Only absolute URLs are supported');
	}

	if (!/^https?:$/.test(parsedURL.protocol)) {
		throw new TypeError('Only HTTP(S) protocols are supported');
	}

	if (request.signal && request.body instanceof Stream.Readable && !streamDestructionSupported) {
		throw new Error('Cancellation of streamed requests with AbortSignal is not supported in node < 8');
	}

	// HTTP-network-or-cache fetch steps 2.4-2.7
	let contentLengthValue = null;
	if (request.body == null && /^(POST|PUT)$/i.test(request.method)) {
		contentLengthValue = '0';
	}
	if (request.body != null) {
		const totalBytes = getTotalBytes(request);
		if (typeof totalBytes === 'number') {
			contentLengthValue = String(totalBytes);
		}
	}
	if (contentLengthValue) {
		headers.set('Content-Length', contentLengthValue);
	}

	// HTTP-network-or-cache fetch step 2.11
	if (!headers.has('User-Agent')) {
		headers.set('User-Agent', 'node-fetch/1.0 (+https://github.com/bitinn/node-fetch)');
	}

	// HTTP-network-or-cache fetch step 2.15
	if (request.compress && !headers.has('Accept-Encoding')) {
		headers.set('Accept-Encoding', 'gzip,deflate');
	}

	let agent = request.agent;
	if (typeof agent === 'function') {
		agent = agent(parsedURL);
	}

	if (!headers.has('Connection') && !agent) {
		headers.set('Connection', 'close');
	}

	// HTTP-network fetch step 4.2
	// chunked encoding is handled by Node.js

	return Object.assign({}, parsedURL, {
		method: request.method,
		headers: exportNodeCompatibleHeaders(headers),
		agent
	});
}

/**
 * abort-error.js
 *
 * AbortError interface for cancelled requests
 */

/**
 * Create AbortError instance
 *
 * @param   String      message      Error message for human
 * @return  AbortError
 */
function AbortError(message) {
  Error.call(this, message);

  this.type = 'aborted';
  this.message = message;

  // hide custom error implementation details from end-users
  Error.captureStackTrace(this, this.constructor);
}

AbortError.prototype = Object.create(Error.prototype);
AbortError.prototype.constructor = AbortError;
AbortError.prototype.name = 'AbortError';

// fix an issue where "PassThrough", "resolve" aren't a named export for node <10
const PassThrough$1 = Stream.PassThrough;
const resolve_url = Url.resolve;

/**
 * Fetch function
 *
 * @param   Mixed    url   Absolute url or Request instance
 * @param   Object   opts  Fetch options
 * @return  Promise
 */
function fetch(url, opts) {

	// allow custom promise
	if (!fetch.Promise) {
		throw new Error('native promise missing, set fetch.Promise to your favorite alternative');
	}

	Body.Promise = fetch.Promise;

	// wrap http.request into fetch
	return new fetch.Promise(function (resolve, reject) {
		// build request object
		const request = new Request(url, opts);
		const options = getNodeRequestOptions(request);

		const send = (options.protocol === 'https:' ? https : http).request;
		const signal = request.signal;

		let response = null;

		const abort = function abort() {
			let error = new AbortError('The user aborted a request.');
			reject(error);
			if (request.body && request.body instanceof Stream.Readable) {
				request.body.destroy(error);
			}
			if (!response || !response.body) return;
			response.body.emit('error', error);
		};

		if (signal && signal.aborted) {
			abort();
			return;
		}

		const abortAndFinalize = function abortAndFinalize() {
			abort();
			finalize();
		};

		// send request
		const req = send(options);
		let reqTimeout;

		if (signal) {
			signal.addEventListener('abort', abortAndFinalize);
		}

		function finalize() {
			req.abort();
			if (signal) signal.removeEventListener('abort', abortAndFinalize);
			clearTimeout(reqTimeout);
		}

		if (request.timeout) {
			req.once('socket', function (socket) {
				reqTimeout = setTimeout(function () {
					reject(new FetchError(`network timeout at: ${request.url}`, 'request-timeout'));
					finalize();
				}, request.timeout);
			});
		}

		req.on('error', function (err) {
			reject(new FetchError(`request to ${request.url} failed, reason: ${err.message}`, 'system', err));
			finalize();
		});

		req.on('response', function (res) {
			clearTimeout(reqTimeout);

			const headers = createHeadersLenient(res.headers);

			// HTTP fetch step 5
			if (fetch.isRedirect(res.statusCode)) {
				// HTTP fetch step 5.2
				const location = headers.get('Location');

				// HTTP fetch step 5.3
				const locationURL = location === null ? null : resolve_url(request.url, location);

				// HTTP fetch step 5.5
				switch (request.redirect) {
					case 'error':
						reject(new FetchError(`redirect mode is set to error: ${request.url}`, 'no-redirect'));
						finalize();
						return;
					case 'manual':
						// node-fetch-specific step: make manual redirect a bit easier to use by setting the Location header value to the resolved URL.
						if (locationURL !== null) {
							// handle corrupted header
							try {
								headers.set('Location', locationURL);
							} catch (err) {
								// istanbul ignore next: nodejs server prevent invalid response headers, we can't test this through normal request
								reject(err);
							}
						}
						break;
					case 'follow':
						// HTTP-redirect fetch step 2
						if (locationURL === null) {
							break;
						}

						// HTTP-redirect fetch step 5
						if (request.counter >= request.follow) {
							reject(new FetchError(`maximum redirect reached at: ${request.url}`, 'max-redirect'));
							finalize();
							return;
						}

						// HTTP-redirect fetch step 6 (counter increment)
						// Create a new Request object.
						const requestOpts = {
							headers: new Headers(request.headers),
							follow: request.follow,
							counter: request.counter + 1,
							agent: request.agent,
							compress: request.compress,
							method: request.method,
							body: request.body,
							signal: request.signal,
							timeout: request.timeout
						};

						// HTTP-redirect fetch step 9
						if (res.statusCode !== 303 && request.body && getTotalBytes(request) === null) {
							reject(new FetchError('Cannot follow redirect with body being a readable stream', 'unsupported-redirect'));
							finalize();
							return;
						}

						// HTTP-redirect fetch step 11
						if (res.statusCode === 303 || (res.statusCode === 301 || res.statusCode === 302) && request.method === 'POST') {
							requestOpts.method = 'GET';
							requestOpts.body = undefined;
							requestOpts.headers.delete('content-length');
						}

						// HTTP-redirect fetch step 15
						resolve(fetch(new Request(locationURL, requestOpts)));
						finalize();
						return;
				}
			}

			// prepare response
			res.once('end', function () {
				if (signal) signal.removeEventListener('abort', abortAndFinalize);
			});
			let body = res.pipe(new PassThrough$1());

			const response_options = {
				url: request.url,
				status: res.statusCode,
				statusText: res.statusMessage,
				headers: headers,
				size: request.size,
				timeout: request.timeout,
				counter: request.counter
			};

			// HTTP-network fetch step 12.1.1.3
			const codings = headers.get('Content-Encoding');

			// HTTP-network fetch step 12.1.1.4: handle content codings

			// in following scenarios we ignore compression support
			// 1. compression support is disabled
			// 2. HEAD request
			// 3. no Content-Encoding header
			// 4. no content response (204)
			// 5. content not modified response (304)
			if (!request.compress || request.method === 'HEAD' || codings === null || res.statusCode === 204 || res.statusCode === 304) {
				response = new Response(body, response_options);
				resolve(response);
				return;
			}

			// For Node v6+
			// Be less strict when decoding compressed responses, since sometimes
			// servers send slightly invalid responses that are still accepted
			// by common browsers.
			// Always using Z_SYNC_FLUSH is what cURL does.
			const zlibOptions = {
				flush: zlib.Z_SYNC_FLUSH,
				finishFlush: zlib.Z_SYNC_FLUSH
			};

			// for gzip
			if (codings == 'gzip' || codings == 'x-gzip') {
				body = body.pipe(zlib.createGunzip(zlibOptions));
				response = new Response(body, response_options);
				resolve(response);
				return;
			}

			// for deflate
			if (codings == 'deflate' || codings == 'x-deflate') {
				// handle the infamous raw deflate response from old servers
				// a hack for old IIS and Apache servers
				const raw = res.pipe(new PassThrough$1());
				raw.once('data', function (chunk) {
					// see http://stackoverflow.com/questions/37519828
					if ((chunk[0] & 0x0F) === 0x08) {
						body = body.pipe(zlib.createInflate());
					} else {
						body = body.pipe(zlib.createInflateRaw());
					}
					response = new Response(body, response_options);
					resolve(response);
				});
				return;
			}

			// for br
			if (codings == 'br' && typeof zlib.createBrotliDecompress === 'function') {
				body = body.pipe(zlib.createBrotliDecompress());
				response = new Response(body, response_options);
				resolve(response);
				return;
			}

			// otherwise, use response as-is
			response = new Response(body, response_options);
			resolve(response);
		});

		writeToStream(req, request);
	});
}
/**
 * Redirect code matching
 *
 * @param   Number   code  Status code
 * @return  Boolean
 */
fetch.isRedirect = function (code) {
	return code === 301 || code === 302 || code === 303 || code === 307 || code === 308;
};

// expose Promise
fetch.Promise = global.Promise;

module.exports = exports = fetch;
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.default = exports;
exports.Headers = Headers;
exports.Request = Request;
exports.Response = Response;
exports.FetchError = FetchError;


/***/ }),

/***/ 7382:
/***/ ((module) => {

"use strict";


/**
 * Converts tokens for a single address into an address object
 *
 * @param {Array} tokens Tokens object
 * @return {Object} Address object
 */
function _handleAddress(tokens) {
    let token;
    let isGroup = false;
    let state = 'text';
    let address;
    let addresses = [];
    let data = {
        address: [],
        comment: [],
        group: [],
        text: []
    };
    let i;
    let len;

    // Filter out <addresses>, (comments) and regular text
    for (i = 0, len = tokens.length; i < len; i++) {
        token = tokens[i];
        if (token.type === 'operator') {
            switch (token.value) {
                case '<':
                    state = 'address';
                    break;
                case '(':
                    state = 'comment';
                    break;
                case ':':
                    state = 'group';
                    isGroup = true;
                    break;
                default:
                    state = 'text';
            }
        } else if (token.value) {
            if (state === 'address') {
                // handle use case where unquoted name includes a "<"
                // Apple Mail truncates everything between an unexpected < and an address
                // and so will we
                token.value = token.value.replace(/^[^<]*<\s*/, '');
            }
            data[state].push(token.value);
        }
    }

    // If there is no text but a comment, replace the two
    if (!data.text.length && data.comment.length) {
        data.text = data.comment;
        data.comment = [];
    }

    if (isGroup) {
        // http://tools.ietf.org/html/rfc2822#appendix-A.1.3
        data.text = data.text.join(' ');
        addresses.push({
            name: data.text || (address && address.name),
            group: data.group.length ? addressparser(data.group.join(',')) : []
        });
    } else {
        // If no address was found, try to detect one from regular text
        if (!data.address.length && data.text.length) {
            for (i = data.text.length - 1; i >= 0; i--) {
                if (data.text[i].match(/^[^@\s]+@[^@\s]+$/)) {
                    data.address = data.text.splice(i, 1);
                    break;
                }
            }

            let _regexHandler = function (address) {
                if (!data.address.length) {
                    data.address = [address.trim()];
                    return ' ';
                } else {
                    return address;
                }
            };

            // still no address
            if (!data.address.length) {
                for (i = data.text.length - 1; i >= 0; i--) {
                    // fixed the regex to parse email address correctly when email address has more than one @
                    data.text[i] = data.text[i].replace(/\s*\b[^@\s]+@[^\s]+\b\s*/, _regexHandler).trim();
                    if (data.address.length) {
                        break;
                    }
                }
            }
        }

        // If there's still is no text but a comment exixts, replace the two
        if (!data.text.length && data.comment.length) {
            data.text = data.comment;
            data.comment = [];
        }

        // Keep only the first address occurence, push others to regular text
        if (data.address.length > 1) {
            data.text = data.text.concat(data.address.splice(1));
        }

        // Join values with spaces
        data.text = data.text.join(' ');
        data.address = data.address.join(' ');

        if (!data.address && isGroup) {
            return [];
        } else {
            address = {
                address: data.address || data.text || '',
                name: data.text || data.address || ''
            };

            if (address.address === address.name) {
                if ((address.address || '').match(/@/)) {
                    address.name = '';
                } else {
                    address.address = '';
                }
            }

            addresses.push(address);
        }
    }

    return addresses;
}

/**
 * Creates a Tokenizer object for tokenizing address field strings
 *
 * @constructor
 * @param {String} str Address field string
 */
class Tokenizer {
    constructor(str) {
        this.str = (str || '').toString();
        this.operatorCurrent = '';
        this.operatorExpecting = '';
        this.node = null;
        this.escaped = false;

        this.list = [];
        /**
         * Operator tokens and which tokens are expected to end the sequence
         */
        this.operators = {
            '"': '"',
            '(': ')',
            '<': '>',
            ',': '',
            ':': ';',
            // Semicolons are not a legal delimiter per the RFC2822 grammar other
            // than for terminating a group, but they are also not valid for any
            // other use in this context.  Given that some mail clients have
            // historically allowed the semicolon as a delimiter equivalent to the
            // comma in their UI, it makes sense to treat them the same as a comma
            // when used outside of a group.
            ';': ''
        };
    }

    /**
     * Tokenizes the original input string
     *
     * @return {Array} An array of operator|text tokens
     */
    tokenize() {
        let chr,
            list = [];
        for (let i = 0, len = this.str.length; i < len; i++) {
            chr = this.str.charAt(i);
            this.checkChar(chr);
        }

        this.list.forEach(node => {
            node.value = (node.value || '').toString().trim();
            if (node.value) {
                list.push(node);
            }
        });

        return list;
    }

    /**
     * Checks if a character is an operator or text and acts accordingly
     *
     * @param {String} chr Character from the address field
     */
    checkChar(chr) {
        if (this.escaped) {
            // ignore next condition blocks
        } else if (chr === this.operatorExpecting) {
            this.node = {
                type: 'operator',
                value: chr
            };
            this.list.push(this.node);
            this.node = null;
            this.operatorExpecting = '';
            this.escaped = false;
            return;
        } else if (!this.operatorExpecting && chr in this.operators) {
            this.node = {
                type: 'operator',
                value: chr
            };
            this.list.push(this.node);
            this.node = null;
            this.operatorExpecting = this.operators[chr];
            this.escaped = false;
            return;
        } else if (['"', "'"].includes(this.operatorExpecting) && chr === '\\') {
            this.escaped = true;
            return;
        }

        if (!this.node) {
            this.node = {
                type: 'text',
                value: ''
            };
            this.list.push(this.node);
        }

        if (chr === '\n') {
            // Convert newlines to spaces. Carriage return is ignored as \r and \n usually
            // go together anyway and there already is a WS for \n. Lone \r means something is fishy.
            chr = ' ';
        }

        if (chr.charCodeAt(0) >= 0x21 || [' ', '\t'].includes(chr)) {
            // skip command bytes
            this.node.value += chr;
        }

        this.escaped = false;
    }
}

/**
 * Parses structured e-mail addresses from an address field
 *
 * Example:
 *
 *    'Name <address@domain>'
 *
 * will be converted to
 *
 *     [{name: 'Name', address: 'address@domain'}]
 *
 * @param {String} str Address field
 * @return {Array} An array of address objects
 */
function addressparser(str, options) {
    options = options || {};

    let tokenizer = new Tokenizer(str);
    let tokens = tokenizer.tokenize();

    let addresses = [];
    let address = [];
    let parsedAddresses = [];

    tokens.forEach(token => {
        if (token.type === 'operator' && (token.value === ',' || token.value === ';')) {
            if (address.length) {
                addresses.push(address);
            }
            address = [];
        } else {
            address.push(token);
        }
    });

    if (address.length) {
        addresses.push(address);
    }

    addresses.forEach(address => {
        address = _handleAddress(address);
        if (address.length) {
            parsedAddresses = parsedAddresses.concat(address);
        }
    });

    if (options.flatten) {
        let addresses = [];
        let walkAddressList = list => {
            list.forEach(address => {
                if (address.group) {
                    return walkAddressList(address.group);
                } else {
                    addresses.push(address);
                }
            });
        };
        walkAddressList(parsedAddresses);
        return addresses;
    }

    return parsedAddresses;
}

// expose to the world
module.exports = addressparser;


/***/ }),

/***/ 4017:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";


const Transform = __webpack_require__(2413).Transform;

/**
 * Encodes a Buffer into a base64 encoded string
 *
 * @param {Buffer} buffer Buffer to convert
 * @returns {String} base64 encoded string
 */
function encode(buffer) {
    if (typeof buffer === 'string') {
        buffer = Buffer.from(buffer, 'utf-8');
    }

    return buffer.toString('base64');
}

/**
 * Adds soft line breaks to a base64 string
 *
 * @param {String} str base64 encoded string that might need line wrapping
 * @param {Number} [lineLength=76] Maximum allowed length for a line
 * @returns {String} Soft-wrapped base64 encoded string
 */
function wrap(str, lineLength) {
    str = (str || '').toString();
    lineLength = lineLength || 76;

    if (str.length <= lineLength) {
        return str;
    }

    let result = [];
    let pos = 0;
    let chunkLength = lineLength * 1024;
    while (pos < str.length) {
        let wrappedLines = str
            .substr(pos, chunkLength)
            .replace(new RegExp('.{' + lineLength + '}', 'g'), '$&\r\n')
            .trim();
        result.push(wrappedLines);
        pos += chunkLength;
    }

    return result.join('\r\n').trim();
}

/**
 * Creates a transform stream for encoding data to base64 encoding
 *
 * @constructor
 * @param {Object} options Stream options
 * @param {Number} [options.lineLength=76] Maximum lenght for lines, set to false to disable wrapping
 */
class Encoder extends Transform {
    constructor(options) {
        super();
        // init Transform
        this.options = options || {};

        if (this.options.lineLength !== false) {
            this.options.lineLength = this.options.lineLength || 76;
        }

        this._curLine = '';
        this._remainingBytes = false;

        this.inputBytes = 0;
        this.outputBytes = 0;
    }

    _transform(chunk, encoding, done) {
        if (encoding !== 'buffer') {
            chunk = Buffer.from(chunk, encoding);
        }

        if (!chunk || !chunk.length) {
            return setImmediate(done);
        }

        this.inputBytes += chunk.length;

        if (this._remainingBytes && this._remainingBytes.length) {
            chunk = Buffer.concat([this._remainingBytes, chunk], this._remainingBytes.length + chunk.length);
            this._remainingBytes = false;
        }

        if (chunk.length % 3) {
            this._remainingBytes = chunk.slice(chunk.length - (chunk.length % 3));
            chunk = chunk.slice(0, chunk.length - (chunk.length % 3));
        } else {
            this._remainingBytes = false;
        }

        let b64 = this._curLine + encode(chunk);

        if (this.options.lineLength) {
            b64 = wrap(b64, this.options.lineLength);

            // remove last line as it is still most probably incomplete
            let lastLF = b64.lastIndexOf('\n');
            if (lastLF < 0) {
                this._curLine = b64;
                b64 = '';
            } else if (lastLF === b64.length - 1) {
                this._curLine = '';
            } else {
                this._curLine = b64.substr(lastLF + 1);
                b64 = b64.substr(0, lastLF + 1);
            }
        }

        if (b64) {
            this.outputBytes += b64.length;
            this.push(Buffer.from(b64, 'ascii'));
        }

        setImmediate(done);
    }

    _flush(done) {
        if (this._remainingBytes && this._remainingBytes.length) {
            this._curLine += encode(this._remainingBytes);
        }

        if (this._curLine) {
            this._curLine = wrap(this._curLine, this.options.lineLength);
            this.outputBytes += this._curLine.length;
            this.push(this._curLine, 'ascii');
            this._curLine = '';
        }
        done();
    }
}

// expose to the world
module.exports = {
    encode,
    wrap,
    Encoder
};


/***/ }),

/***/ 7757:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";


// FIXME:
// replace this Transform mess with a method that pipes input argument to output argument

const MessageParser = __webpack_require__(6196);
const RelaxedBody = __webpack_require__(1412);
const sign = __webpack_require__(9475);
const PassThrough = __webpack_require__(2413).PassThrough;
const fs = __webpack_require__(5747);
const path = __webpack_require__(5622);
const crypto = __webpack_require__(6417);

const DKIM_ALGO = 'sha256';
const MAX_MESSAGE_SIZE = 128 * 1024; // buffer messages larger than this to disk

/*
// Usage:

let dkim = new DKIM({
    domainName: 'example.com',
    keySelector: 'key-selector',
    privateKey,
    cacheDir: '/tmp'
});
dkim.sign(input).pipe(process.stdout);

// Where inputStream is a rfc822 message (either a stream, string or Buffer)
// and outputStream is a DKIM signed rfc822 message
*/

class DKIMSigner {
    constructor(options, keys, input, output) {
        this.options = options || {};
        this.keys = keys;

        this.cacheTreshold = Number(this.options.cacheTreshold) || MAX_MESSAGE_SIZE;
        this.hashAlgo = this.options.hashAlgo || DKIM_ALGO;

        this.cacheDir = this.options.cacheDir || false;

        this.chunks = [];
        this.chunklen = 0;
        this.readPos = 0;
        this.cachePath = this.cacheDir ? path.join(this.cacheDir, 'message.' + Date.now() + '-' + crypto.randomBytes(14).toString('hex')) : false;
        this.cache = false;

        this.headers = false;
        this.bodyHash = false;
        this.parser = false;
        this.relaxedBody = false;

        this.input = input;
        this.output = output;
        this.output.usingCache = false;

        this.errored = false;

        this.input.on('error', err => {
            this.errored = true;
            this.cleanup();
            output.emit('error', err);
        });
    }

    cleanup() {
        if (!this.cache || !this.cachePath) {
            return;
        }
        fs.unlink(this.cachePath, () => false);
    }

    createReadCache() {
        // pipe remainings to cache file
        this.cache = fs.createReadStream(this.cachePath);
        this.cache.once('error', err => {
            this.cleanup();
            this.output.emit('error', err);
        });
        this.cache.once('close', () => {
            this.cleanup();
        });
        this.cache.pipe(this.output);
    }

    sendNextChunk() {
        if (this.errored) {
            return;
        }

        if (this.readPos >= this.chunks.length) {
            if (!this.cache) {
                return this.output.end();
            }
            return this.createReadCache();
        }
        let chunk = this.chunks[this.readPos++];
        if (this.output.write(chunk) === false) {
            return this.output.once('drain', () => {
                this.sendNextChunk();
            });
        }
        setImmediate(() => this.sendNextChunk());
    }

    sendSignedOutput() {
        let keyPos = 0;
        let signNextKey = () => {
            if (keyPos >= this.keys.length) {
                this.output.write(this.parser.rawHeaders);
                return setImmediate(() => this.sendNextChunk());
            }
            let key = this.keys[keyPos++];
            let dkimField = sign(this.headers, this.hashAlgo, this.bodyHash, {
                domainName: key.domainName,
                keySelector: key.keySelector,
                privateKey: key.privateKey,
                headerFieldNames: this.options.headerFieldNames,
                skipFields: this.options.skipFields
            });
            if (dkimField) {
                this.output.write(Buffer.from(dkimField + '\r\n'));
            }
            return setImmediate(signNextKey);
        };

        if (this.bodyHash && this.headers) {
            return signNextKey();
        }

        this.output.write(this.parser.rawHeaders);
        this.sendNextChunk();
    }

    createWriteCache() {
        this.output.usingCache = true;
        // pipe remainings to cache file
        this.cache = fs.createWriteStream(this.cachePath);
        this.cache.once('error', err => {
            this.cleanup();
            // drain input
            this.relaxedBody.unpipe(this.cache);
            this.relaxedBody.on('readable', () => {
                while (this.relaxedBody.read() !== null) {
                    // do nothing
                }
            });
            this.errored = true;
            // emit error
            this.output.emit('error', err);
        });
        this.cache.once('close', () => {
            this.sendSignedOutput();
        });
        this.relaxedBody.removeAllListeners('readable');
        this.relaxedBody.pipe(this.cache);
    }

    signStream() {
        this.parser = new MessageParser();
        this.relaxedBody = new RelaxedBody({
            hashAlgo: this.hashAlgo
        });

        this.parser.on('headers', value => {
            this.headers = value;
        });

        this.relaxedBody.on('hash', value => {
            this.bodyHash = value;
        });

        this.relaxedBody.on('readable', () => {
            let chunk;
            if (this.cache) {
                return;
            }
            while ((chunk = this.relaxedBody.read()) !== null) {
                this.chunks.push(chunk);
                this.chunklen += chunk.length;
                if (this.chunklen >= this.cacheTreshold && this.cachePath) {
                    return this.createWriteCache();
                }
            }
        });

        this.relaxedBody.on('end', () => {
            if (this.cache) {
                return;
            }
            this.sendSignedOutput();
        });

        this.parser.pipe(this.relaxedBody);
        setImmediate(() => this.input.pipe(this.parser));
    }
}

class DKIM {
    constructor(options) {
        this.options = options || {};
        this.keys = [].concat(
            this.options.keys || {
                domainName: options.domainName,
                keySelector: options.keySelector,
                privateKey: options.privateKey
            }
        );
    }

    sign(input, extraOptions) {
        let output = new PassThrough();
        let inputStream = input;
        let writeValue = false;

        if (Buffer.isBuffer(input)) {
            writeValue = input;
            inputStream = new PassThrough();
        } else if (typeof input === 'string') {
            writeValue = Buffer.from(input);
            inputStream = new PassThrough();
        }

        let options = this.options;
        if (extraOptions && Object.keys(extraOptions).length) {
            options = {};
            Object.keys(this.options || {}).forEach(key => {
                options[key] = this.options[key];
            });
            Object.keys(extraOptions || {}).forEach(key => {
                if (!(key in options)) {
                    options[key] = extraOptions[key];
                }
            });
        }

        let signer = new DKIMSigner(options, this.keys, inputStream, output);
        setImmediate(() => {
            signer.signStream();
            if (writeValue) {
                setImmediate(() => {
                    inputStream.end(writeValue);
                });
            }
        });

        return output;
    }
}

module.exports = DKIM;


/***/ }),

/***/ 6196:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";


const Transform = __webpack_require__(2413).Transform;

/**
 * MessageParser instance is a transform stream that separates message headers
 * from the rest of the body. Headers are emitted with the 'headers' event. Message
 * body is passed on as the resulting stream.
 */
class MessageParser extends Transform {
    constructor(options) {
        super(options);
        this.lastBytes = Buffer.alloc(4);
        this.headersParsed = false;
        this.headerBytes = 0;
        this.headerChunks = [];
        this.rawHeaders = false;
        this.bodySize = 0;
    }

    /**
     * Keeps count of the last 4 bytes in order to detect line breaks on chunk boundaries
     *
     * @param {Buffer} data Next data chunk from the stream
     */
    updateLastBytes(data) {
        let lblen = this.lastBytes.length;
        let nblen = Math.min(data.length, lblen);

        // shift existing bytes
        for (let i = 0, len = lblen - nblen; i < len; i++) {
            this.lastBytes[i] = this.lastBytes[i + nblen];
        }

        // add new bytes
        for (let i = 1; i <= nblen; i++) {
            this.lastBytes[lblen - i] = data[data.length - i];
        }
    }

    /**
     * Finds and removes message headers from the remaining body. We want to keep
     * headers separated until final delivery to be able to modify these
     *
     * @param {Buffer} data Next chunk of data
     * @return {Boolean} Returns true if headers are already found or false otherwise
     */
    checkHeaders(data) {
        if (this.headersParsed) {
            return true;
        }

        let lblen = this.lastBytes.length;
        let headerPos = 0;
        this.curLinePos = 0;
        for (let i = 0, len = this.lastBytes.length + data.length; i < len; i++) {
            let chr;
            if (i < lblen) {
                chr = this.lastBytes[i];
            } else {
                chr = data[i - lblen];
            }
            if (chr === 0x0a && i) {
                let pr1 = i - 1 < lblen ? this.lastBytes[i - 1] : data[i - 1 - lblen];
                let pr2 = i > 1 ? (i - 2 < lblen ? this.lastBytes[i - 2] : data[i - 2 - lblen]) : false;
                if (pr1 === 0x0a) {
                    this.headersParsed = true;
                    headerPos = i - lblen + 1;
                    this.headerBytes += headerPos;
                    break;
                } else if (pr1 === 0x0d && pr2 === 0x0a) {
                    this.headersParsed = true;
                    headerPos = i - lblen + 1;
                    this.headerBytes += headerPos;
                    break;
                }
            }
        }

        if (this.headersParsed) {
            this.headerChunks.push(data.slice(0, headerPos));
            this.rawHeaders = Buffer.concat(this.headerChunks, this.headerBytes);
            this.headerChunks = null;
            this.emit('headers', this.parseHeaders());
            if (data.length - 1 > headerPos) {
                let chunk = data.slice(headerPos);
                this.bodySize += chunk.length;
                // this would be the first chunk of data sent downstream
                setImmediate(() => this.push(chunk));
            }
            return false;
        } else {
            this.headerBytes += data.length;
            this.headerChunks.push(data);
        }

        // store last 4 bytes to catch header break
        this.updateLastBytes(data);

        return false;
    }

    _transform(chunk, encoding, callback) {
        if (!chunk || !chunk.length) {
            return callback();
        }

        if (typeof chunk === 'string') {
            chunk = Buffer.from(chunk, encoding);
        }

        let headersFound;

        try {
            headersFound = this.checkHeaders(chunk);
        } catch (E) {
            return callback(E);
        }

        if (headersFound) {
            this.bodySize += chunk.length;
            this.push(chunk);
        }

        setImmediate(callback);
    }

    _flush(callback) {
        if (this.headerChunks) {
            let chunk = Buffer.concat(this.headerChunks, this.headerBytes);
            this.bodySize += chunk.length;
            this.push(chunk);
            this.headerChunks = null;
        }
        callback();
    }

    parseHeaders() {
        let lines = (this.rawHeaders || '').toString().split(/\r?\n/);
        for (let i = lines.length - 1; i > 0; i--) {
            if (/^\s/.test(lines[i])) {
                lines[i - 1] += '\n' + lines[i];
                lines.splice(i, 1);
            }
        }
        return lines
            .filter(line => line.trim())
            .map(line => ({
                key: line
                    .substr(0, line.indexOf(':'))
                    .trim()
                    .toLowerCase(),
                line
            }));
    }
}

module.exports = MessageParser;


/***/ }),

/***/ 1412:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";


// streams through a message body and calculates relaxed body hash

const Transform = __webpack_require__(2413).Transform;
const crypto = __webpack_require__(6417);

class RelaxedBody extends Transform {
    constructor(options) {
        super();
        options = options || {};
        this.chunkBuffer = [];
        this.chunkBufferLen = 0;
        this.bodyHash = crypto.createHash(options.hashAlgo || 'sha1');
        this.remainder = '';
        this.byteLength = 0;

        this.debug = options.debug;
        this._debugBody = options.debug ? [] : false;
    }

    updateHash(chunk) {
        let bodyStr;

        // find next remainder
        let nextRemainder = '';

        // This crux finds and removes the spaces from the last line and the newline characters after the last non-empty line
        // If we get another chunk that does not match this description then we can restore the previously processed data
        let state = 'file';
        for (let i = chunk.length - 1; i >= 0; i--) {
            let c = chunk[i];

            if (state === 'file' && (c === 0x0a || c === 0x0d)) {
                // do nothing, found \n or \r at the end of chunk, stil end of file
            } else if (state === 'file' && (c === 0x09 || c === 0x20)) {
                // switch to line ending mode, this is the last non-empty line
                state = 'line';
            } else if (state === 'line' && (c === 0x09 || c === 0x20)) {
                // do nothing, found ' ' or \t at the end of line, keep processing the last non-empty line
            } else if (state === 'file' || state === 'line') {
                // non line/file ending character found, switch to body mode
                state = 'body';
                if (i === chunk.length - 1) {
                    // final char is not part of line end or file end, so do nothing
                    break;
                }
            }

            if (i === 0) {
                // reached to the beginning of the chunk, check if it is still about the ending
                // and if the remainder also matches
                if (
                    (state === 'file' && (!this.remainder || /[\r\n]$/.test(this.remainder))) ||
                    (state === 'line' && (!this.remainder || /[ \t]$/.test(this.remainder)))
                ) {
                    // keep everything
                    this.remainder += chunk.toString('binary');
                    return;
                } else if (state === 'line' || state === 'file') {
                    // process existing remainder as normal line but store the current chunk
                    nextRemainder = chunk.toString('binary');
                    chunk = false;
                    break;
                }
            }

            if (state !== 'body') {
                continue;
            }

            // reached first non ending byte
            nextRemainder = chunk.slice(i + 1).toString('binary');
            chunk = chunk.slice(0, i + 1);
            break;
        }

        let needsFixing = !!this.remainder;
        if (chunk && !needsFixing) {
            // check if we even need to change anything
            for (let i = 0, len = chunk.length; i < len; i++) {
                if (i && chunk[i] === 0x0a && chunk[i - 1] !== 0x0d) {
                    // missing \r before \n
                    needsFixing = true;
                    break;
                } else if (i && chunk[i] === 0x0d && chunk[i - 1] === 0x20) {
                    // trailing WSP found
                    needsFixing = true;
                    break;
                } else if (i && chunk[i] === 0x20 && chunk[i - 1] === 0x20) {
                    // multiple spaces found, needs to be replaced with just one
                    needsFixing = true;
                    break;
                } else if (chunk[i] === 0x09) {
                    // TAB found, needs to be replaced with a space
                    needsFixing = true;
                    break;
                }
            }
        }

        if (needsFixing) {
            bodyStr = this.remainder + (chunk ? chunk.toString('binary') : '');
            this.remainder = nextRemainder;
            bodyStr = bodyStr
                .replace(/\r?\n/g, '\n') // use js line endings
                .replace(/[ \t]*$/gm, '') // remove line endings, rtrim
                .replace(/[ \t]+/gm, ' ') // single spaces
                .replace(/\n/g, '\r\n'); // restore rfc822 line endings
            chunk = Buffer.from(bodyStr, 'binary');
        } else if (nextRemainder) {
            this.remainder = nextRemainder;
        }

        if (this.debug) {
            this._debugBody.push(chunk);
        }
        this.bodyHash.update(chunk);
    }

    _transform(chunk, encoding, callback) {
        if (!chunk || !chunk.length) {
            return callback();
        }

        if (typeof chunk === 'string') {
            chunk = Buffer.from(chunk, encoding);
        }

        this.updateHash(chunk);

        this.byteLength += chunk.length;
        this.push(chunk);
        callback();
    }

    _flush(callback) {
        // generate final hash and emit it
        if (/[\r\n]$/.test(this.remainder) && this.byteLength > 2) {
            // add terminating line end
            this.bodyHash.update(Buffer.from('\r\n'));
        }
        if (!this.byteLength) {
            // emit empty line buffer to keep the stream flowing
            this.push(Buffer.from('\r\n'));
            // this.bodyHash.update(Buffer.from('\r\n'));
        }

        this.emit('hash', this.bodyHash.digest('base64'), this.debug ? Buffer.concat(this._debugBody) : false);
        callback();
    }
}

module.exports = RelaxedBody;


/***/ }),

/***/ 9475:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";


const punycode = __webpack_require__(4213);
const mimeFuncs = __webpack_require__(994);
const crypto = __webpack_require__(6417);

/**
 * Returns DKIM signature header line
 *
 * @param {Object} headers Parsed headers object from MessageParser
 * @param {String} bodyHash Base64 encoded hash of the message
 * @param {Object} options DKIM options
 * @param {String} options.domainName Domain name to be signed for
 * @param {String} options.keySelector DKIM key selector to use
 * @param {String} options.privateKey DKIM private key to use
 * @return {String} Complete header line
 */

module.exports = (headers, hashAlgo, bodyHash, options) => {
    options = options || {};

    // all listed fields from RFC4871 #5.5
    let defaultFieldNames =
        'From:Sender:Reply-To:Subject:Date:Message-ID:To:' +
        'Cc:MIME-Version:Content-Type:Content-Transfer-Encoding:Content-ID:' +
        'Content-Description:Resent-Date:Resent-From:Resent-Sender:' +
        'Resent-To:Resent-Cc:Resent-Message-ID:In-Reply-To:References:' +
        'List-Id:List-Help:List-Unsubscribe:List-Subscribe:List-Post:' +
        'List-Owner:List-Archive';

    let fieldNames = options.headerFieldNames || defaultFieldNames;

    let canonicalizedHeaderData = relaxedHeaders(headers, fieldNames, options.skipFields);
    let dkimHeader = generateDKIMHeader(options.domainName, options.keySelector, canonicalizedHeaderData.fieldNames, hashAlgo, bodyHash);

    let signer, signature;

    canonicalizedHeaderData.headers += 'dkim-signature:' + relaxedHeaderLine(dkimHeader);

    signer = crypto.createSign(('rsa-' + hashAlgo).toUpperCase());
    signer.update(canonicalizedHeaderData.headers);
    try {
        signature = signer.sign(options.privateKey, 'base64');
    } catch (E) {
        return false;
    }

    return dkimHeader + signature.replace(/(^.{73}|.{75}(?!\r?\n|\r))/g, '$&\r\n ').trim();
};

module.exports.relaxedHeaders = relaxedHeaders;

function generateDKIMHeader(domainName, keySelector, fieldNames, hashAlgo, bodyHash) {
    let dkim = [
        'v=1',
        'a=rsa-' + hashAlgo,
        'c=relaxed/relaxed',
        'd=' + punycode.toASCII(domainName),
        'q=dns/txt',
        's=' + keySelector,
        'bh=' + bodyHash,
        'h=' + fieldNames
    ].join('; ');

    return mimeFuncs.foldLines('DKIM-Signature: ' + dkim, 76) + ';\r\n b=';
}

function relaxedHeaders(headers, fieldNames, skipFields) {
    let includedFields = new Set();
    let skip = new Set();
    let headerFields = new Map();

    (skipFields || '')
        .toLowerCase()
        .split(':')
        .forEach(field => {
            skip.add(field.trim());
        });

    (fieldNames || '')
        .toLowerCase()
        .split(':')
        .filter(field => !skip.has(field.trim()))
        .forEach(field => {
            includedFields.add(field.trim());
        });

    for (let i = headers.length - 1; i >= 0; i--) {
        let line = headers[i];
        // only include the first value from bottom to top
        if (includedFields.has(line.key) && !headerFields.has(line.key)) {
            headerFields.set(line.key, relaxedHeaderLine(line.line));
        }
    }

    let headersList = [];
    let fields = [];
    includedFields.forEach(field => {
        if (headerFields.has(field)) {
            fields.push(field);
            headersList.push(field + ':' + headerFields.get(field));
        }
    });

    return {
        headers: headersList.join('\r\n') + '\r\n',
        fieldNames: fields.join(':')
    };
}

function relaxedHeaderLine(line) {
    return line
        .substr(line.indexOf(':') + 1)
        .replace(/\r?\n/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}


/***/ }),

/***/ 322:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";


// module to handle cookies

const urllib = __webpack_require__(8835);

const SESSION_TIMEOUT = 1800; // 30 min

/**
 * Creates a biskviit cookie jar for managing cookie values in memory
 *
 * @constructor
 * @param {Object} [options] Optional options object
 */
class Cookies {
    constructor(options) {
        this.options = options || {};
        this.cookies = [];
    }

    /**
     * Stores a cookie string to the cookie storage
     *
     * @param {String} cookieStr Value from the 'Set-Cookie:' header
     * @param {String} url Current URL
     */
    set(cookieStr, url) {
        let urlparts = urllib.parse(url || '');
        let cookie = this.parse(cookieStr);
        let domain;

        if (cookie.domain) {
            domain = cookie.domain.replace(/^\./, '');

            // do not allow cross origin cookies
            if (
                // can't be valid if the requested domain is shorter than current hostname
                urlparts.hostname.length < domain.length ||
                // prefix domains with dot to be sure that partial matches are not used
                ('.' + urlparts.hostname).substr(-domain.length + 1) !== '.' + domain
            ) {
                cookie.domain = urlparts.hostname;
            }
        } else {
            cookie.domain = urlparts.hostname;
        }

        if (!cookie.path) {
            cookie.path = this.getPath(urlparts.pathname);
        }

        // if no expire date, then use sessionTimeout value
        if (!cookie.expires) {
            cookie.expires = new Date(Date.now() + (Number(this.options.sessionTimeout || SESSION_TIMEOUT) || SESSION_TIMEOUT) * 1000);
        }

        return this.add(cookie);
    }

    /**
     * Returns cookie string for the 'Cookie:' header.
     *
     * @param {String} url URL to check for
     * @returns {String} Cookie header or empty string if no matches were found
     */
    get(url) {
        return this.list(url)
            .map(cookie => cookie.name + '=' + cookie.value)
            .join('; ');
    }

    /**
     * Lists all valied cookie objects for the specified URL
     *
     * @param {String} url URL to check for
     * @returns {Array} An array of cookie objects
     */
    list(url) {
        let result = [];
        let i;
        let cookie;

        for (i = this.cookies.length - 1; i >= 0; i--) {
            cookie = this.cookies[i];

            if (this.isExpired(cookie)) {
                this.cookies.splice(i, i);
                continue;
            }

            if (this.match(cookie, url)) {
                result.unshift(cookie);
            }
        }

        return result;
    }

    /**
     * Parses cookie string from the 'Set-Cookie:' header
     *
     * @param {String} cookieStr String from the 'Set-Cookie:' header
     * @returns {Object} Cookie object
     */
    parse(cookieStr) {
        let cookie = {};

        (cookieStr || '')
            .toString()
            .split(';')
            .forEach(cookiePart => {
                let valueParts = cookiePart.split('=');
                let key = valueParts
                    .shift()
                    .trim()
                    .toLowerCase();
                let value = valueParts.join('=').trim();
                let domain;

                if (!key) {
                    // skip empty parts
                    return;
                }

                switch (key) {
                    case 'expires':
                        value = new Date(value);
                        // ignore date if can not parse it
                        if (value.toString() !== 'Invalid Date') {
                            cookie.expires = value;
                        }
                        break;

                    case 'path':
                        cookie.path = value;
                        break;

                    case 'domain':
                        domain = value.toLowerCase();
                        if (domain.length && domain.charAt(0) !== '.') {
                            domain = '.' + domain; // ensure preceeding dot for user set domains
                        }
                        cookie.domain = domain;
                        break;

                    case 'max-age':
                        cookie.expires = new Date(Date.now() + (Number(value) || 0) * 1000);
                        break;

                    case 'secure':
                        cookie.secure = true;
                        break;

                    case 'httponly':
                        cookie.httponly = true;
                        break;

                    default:
                        if (!cookie.name) {
                            cookie.name = key;
                            cookie.value = value;
                        }
                }
            });

        return cookie;
    }

    /**
     * Checks if a cookie object is valid for a specified URL
     *
     * @param {Object} cookie Cookie object
     * @param {String} url URL to check for
     * @returns {Boolean} true if cookie is valid for specifiec URL
     */
    match(cookie, url) {
        let urlparts = urllib.parse(url || '');

        // check if hostname matches
        // .foo.com also matches subdomains, foo.com does not
        if (
            urlparts.hostname !== cookie.domain &&
            (cookie.domain.charAt(0) !== '.' || ('.' + urlparts.hostname).substr(-cookie.domain.length) !== cookie.domain)
        ) {
            return false;
        }

        // check if path matches
        let path = this.getPath(urlparts.pathname);
        if (path.substr(0, cookie.path.length) !== cookie.path) {
            return false;
        }

        // check secure argument
        if (cookie.secure && urlparts.protocol !== 'https:') {
            return false;
        }

        return true;
    }

    /**
     * Adds (or updates/removes if needed) a cookie object to the cookie storage
     *
     * @param {Object} cookie Cookie value to be stored
     */
    add(cookie) {
        let i;
        let len;

        // nothing to do here
        if (!cookie || !cookie.name) {
            return false;
        }

        // overwrite if has same params
        for (i = 0, len = this.cookies.length; i < len; i++) {
            if (this.compare(this.cookies[i], cookie)) {
                // check if the cookie needs to be removed instead
                if (this.isExpired(cookie)) {
                    this.cookies.splice(i, 1); // remove expired/unset cookie
                    return false;
                }

                this.cookies[i] = cookie;
                return true;
            }
        }

        // add as new if not already expired
        if (!this.isExpired(cookie)) {
            this.cookies.push(cookie);
        }

        return true;
    }

    /**
     * Checks if two cookie objects are the same
     *
     * @param {Object} a Cookie to check against
     * @param {Object} b Cookie to check against
     * @returns {Boolean} True, if the cookies are the same
     */
    compare(a, b) {
        return a.name === b.name && a.path === b.path && a.domain === b.domain && a.secure === b.secure && a.httponly === a.httponly;
    }

    /**
     * Checks if a cookie is expired
     *
     * @param {Object} cookie Cookie object to check against
     * @returns {Boolean} True, if the cookie is expired
     */
    isExpired(cookie) {
        return (cookie.expires && cookie.expires < new Date()) || !cookie.value;
    }

    /**
     * Returns normalized cookie path for an URL path argument
     *
     * @param {String} pathname
     * @returns {String} Normalized path
     */
    getPath(pathname) {
        let path = (pathname || '/').split('/');
        path.pop(); // remove filename part
        path = path.join('/').trim();

        // ensure path prefix /
        if (path.charAt(0) !== '/') {
            path = '/' + path;
        }

        // ensure path suffix /
        if (path.substr(-1) !== '/') {
            path += '/';
        }

        return path;
    }
}

module.exports = Cookies;


/***/ }),

/***/ 9106:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";


const http = __webpack_require__(8605);
const https = __webpack_require__(7211);
const urllib = __webpack_require__(8835);
const zlib = __webpack_require__(8761);
const PassThrough = __webpack_require__(2413).PassThrough;
const Cookies = __webpack_require__(322);
const packageData = __webpack_require__(7643);

const MAX_REDIRECTS = 5;

module.exports = function(url, options) {
    return fetch(url, options);
};

module.exports.Cookies = Cookies;

function fetch(url, options) {
    options = options || {};

    options.fetchRes = options.fetchRes || new PassThrough();
    options.cookies = options.cookies || new Cookies();
    options.redirects = options.redirects || 0;
    options.maxRedirects = isNaN(options.maxRedirects) ? MAX_REDIRECTS : options.maxRedirects;

    if (options.cookie) {
        [].concat(options.cookie || []).forEach(cookie => {
            options.cookies.set(cookie, url);
        });
        options.cookie = false;
    }

    let fetchRes = options.fetchRes;
    let parsed = urllib.parse(url);
    let method =
        (options.method || '')
            .toString()
            .trim()
            .toUpperCase() || 'GET';
    let finished = false;
    let cookies;
    let body;

    let handler = parsed.protocol === 'https:' ? https : http;

    let headers = {
        'accept-encoding': 'gzip,deflate',
        'user-agent': 'nodemailer/' + packageData.version
    };

    Object.keys(options.headers || {}).forEach(key => {
        headers[key.toLowerCase().trim()] = options.headers[key];
    });

    if (options.userAgent) {
        headers['user-agent'] = options.userAgent;
    }

    if (parsed.auth) {
        headers.Authorization = 'Basic ' + Buffer.from(parsed.auth).toString('base64');
    }

    if ((cookies = options.cookies.get(url))) {
        headers.cookie = cookies;
    }

    if (options.body) {
        if (options.contentType !== false) {
            headers['Content-Type'] = options.contentType || 'application/x-www-form-urlencoded';
        }

        if (typeof options.body.pipe === 'function') {
            // it's a stream
            headers['Transfer-Encoding'] = 'chunked';
            body = options.body;
            body.on('error', err => {
                if (finished) {
                    return;
                }
                finished = true;
                err.type = 'FETCH';
                err.sourceUrl = url;
                fetchRes.emit('error', err);
            });
        } else {
            if (options.body instanceof Buffer) {
                body = options.body;
            } else if (typeof options.body === 'object') {
                try {
                    // encodeURIComponent can fail on invalid input (partial emoji etc.)
                    body = Buffer.from(
                        Object.keys(options.body)
                            .map(key => {
                                let value = options.body[key].toString().trim();
                                return encodeURIComponent(key) + '=' + encodeURIComponent(value);
                            })
                            .join('&')
                    );
                } catch (E) {
                    if (finished) {
                        return;
                    }
                    finished = true;
                    E.type = 'FETCH';
                    E.sourceUrl = url;
                    fetchRes.emit('error', E);
                    return;
                }
            } else {
                body = Buffer.from(options.body.toString().trim());
            }

            headers['Content-Type'] = options.contentType || 'application/x-www-form-urlencoded';
            headers['Content-Length'] = body.length;
        }
        // if method is not provided, use POST instead of GET
        method =
            (options.method || '')
                .toString()
                .trim()
                .toUpperCase() || 'POST';
    }

    let req;
    let reqOptions = {
        method,
        host: parsed.hostname,
        path: parsed.path,
        port: parsed.port ? parsed.port : parsed.protocol === 'https:' ? 443 : 80,
        headers,
        rejectUnauthorized: false,
        agent: false
    };

    if (options.tls) {
        Object.keys(options.tls).forEach(key => {
            reqOptions[key] = options.tls[key];
        });
    }

    try {
        req = handler.request(reqOptions);
    } catch (E) {
        finished = true;
        setImmediate(() => {
            E.type = 'FETCH';
            E.sourceUrl = url;
            fetchRes.emit('error', E);
        });
        return fetchRes;
    }

    if (options.timeout) {
        req.setTimeout(options.timeout, () => {
            if (finished) {
                return;
            }
            finished = true;
            req.abort();
            let err = new Error('Request Timeout');
            err.type = 'FETCH';
            err.sourceUrl = url;
            fetchRes.emit('error', err);
        });
    }

    req.on('error', err => {
        if (finished) {
            return;
        }
        finished = true;
        err.type = 'FETCH';
        err.sourceUrl = url;
        fetchRes.emit('error', err);
    });

    req.on('response', res => {
        let inflate;

        if (finished) {
            return;
        }

        switch (res.headers['content-encoding']) {
            case 'gzip':
            case 'deflate':
                inflate = zlib.createUnzip();
                break;
        }

        if (res.headers['set-cookie']) {
            [].concat(res.headers['set-cookie'] || []).forEach(cookie => {
                options.cookies.set(cookie, url);
            });
        }

        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            // redirect
            options.redirects++;
            if (options.redirects > options.maxRedirects) {
                finished = true;
                let err = new Error('Maximum redirect count exceeded');
                err.type = 'FETCH';
                err.sourceUrl = url;
                fetchRes.emit('error', err);
                req.abort();
                return;
            }
            // redirect does not include POST body
            options.method = 'GET';
            options.body = false;
            return fetch(urllib.resolve(url, res.headers.location), options);
        }

        fetchRes.statusCode = res.statusCode;
        fetchRes.headers = res.headers;

        if (res.statusCode >= 300 && !options.allowErrorResponse) {
            finished = true;
            let err = new Error('Invalid status code ' + res.statusCode);
            err.type = 'FETCH';
            err.sourceUrl = url;
            fetchRes.emit('error', err);
            req.abort();
            return;
        }

        res.on('error', err => {
            if (finished) {
                return;
            }
            finished = true;
            err.type = 'FETCH';
            err.sourceUrl = url;
            fetchRes.emit('error', err);
            req.abort();
        });

        if (inflate) {
            res.pipe(inflate).pipe(fetchRes);
            inflate.on('error', err => {
                if (finished) {
                    return;
                }
                finished = true;
                err.type = 'FETCH';
                err.sourceUrl = url;
                fetchRes.emit('error', err);
                req.abort();
            });
        } else {
            res.pipe(fetchRes);
        }
    });

    setImmediate(() => {
        if (body) {
            try {
                if (typeof body.pipe === 'function') {
                    return body.pipe(req);
                } else {
                    req.write(body);
                }
            } catch (err) {
                finished = true;
                err.type = 'FETCH';
                err.sourceUrl = url;
                fetchRes.emit('error', err);
                return;
            }
        }
        req.end();
    });

    return fetchRes;
}


/***/ }),

/***/ 3819:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";


const packageData = __webpack_require__(7643);
const shared = __webpack_require__(2673);

/**
 * Generates a Transport object to generate JSON output
 *
 * @constructor
 * @param {Object} optional config parameter
 */
class JSONTransport {
    constructor(options) {
        options = options || {};

        this.options = options || {};

        this.name = 'JSONTransport';
        this.version = packageData.version;

        this.logger = shared.getLogger(this.options, {
            component: this.options.component || 'json-transport'
        });
    }

    /**
     * <p>Compiles a mailcomposer message and forwards it to handler that sends it.</p>
     *
     * @param {Object} emailMessage MailComposer object
     * @param {Function} callback Callback function to run when the sending is completed
     */
    send(mail, done) {
        // Sendmail strips this header line by itself
        mail.message.keepBcc = true;

        let envelope = mail.data.envelope || mail.message.getEnvelope();
        let messageId = mail.message.messageId();

        let recipients = [].concat(envelope.to || []);
        if (recipients.length > 3) {
            recipients.push('...and ' + recipients.splice(2).length + ' more');
        }
        this.logger.info(
            {
                tnx: 'send',
                messageId
            },
            'Composing JSON structure of %s to <%s>',
            messageId,
            recipients.join(', ')
        );

        setImmediate(() => {
            mail.normalize((err, data) => {
                if (err) {
                    this.logger.error(
                        {
                            err,
                            tnx: 'send',
                            messageId
                        },
                        'Failed building JSON structure for %s. %s',
                        messageId,
                        err.message
                    );
                    return done(err);
                }

                delete data.envelope;
                delete data.normalizedHeaders;

                return done(null, {
                    envelope,
                    messageId,
                    message: this.options.skipEncoding ? data : JSON.stringify(data)
                });
            });
        });
    }
}

module.exports = JSONTransport;


/***/ }),

/***/ 1694:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";
/* eslint no-undefined: 0 */



const MimeNode = __webpack_require__(8509);
const mimeFuncs = __webpack_require__(994);

/**
 * Creates the object for composing a MimeNode instance out from the mail options
 *
 * @constructor
 * @param {Object} mail Mail options
 */
class MailComposer {
    constructor(mail) {
        this.mail = mail || {};
        this.message = false;
    }

    /**
     * Builds MimeNode instance
     */
    compile() {
        this._alternatives = this.getAlternatives();
        this._htmlNode = this._alternatives.filter(alternative => /^text\/html\b/i.test(alternative.contentType)).pop();
        this._attachments = this.getAttachments(!!this._htmlNode);

        this._useRelated = !!(this._htmlNode && this._attachments.related.length);
        this._useAlternative = this._alternatives.length > 1;
        this._useMixed = this._attachments.attached.length > 1 || (this._alternatives.length && this._attachments.attached.length === 1);

        // Compose MIME tree
        if (this.mail.raw) {
            this.message = new MimeNode().setRaw(this.mail.raw);
        } else if (this._useMixed) {
            this.message = this._createMixed();
        } else if (this._useAlternative) {
            this.message = this._createAlternative();
        } else if (this._useRelated) {
            this.message = this._createRelated();
        } else {
            this.message = this._createContentNode(
                false,
                []
                    .concat(this._alternatives || [])
                    .concat(this._attachments.attached || [])
                    .shift() || {
                    contentType: 'text/plain',
                    content: ''
                }
            );
        }

        // Add custom headers
        if (this.mail.headers) {
            this.message.addHeader(this.mail.headers);
        }

        // Add headers to the root node, always overrides custom headers
        ['from', 'sender', 'to', 'cc', 'bcc', 'reply-to', 'in-reply-to', 'references', 'subject', 'message-id', 'date'].forEach(header => {
            let key = header.replace(/-(\w)/g, (o, c) => c.toUpperCase());
            if (this.mail[key]) {
                this.message.setHeader(header, this.mail[key]);
            }
        });

        // Sets custom envelope
        if (this.mail.envelope) {
            this.message.setEnvelope(this.mail.envelope);
        }

        // ensure Message-Id value
        this.message.messageId();

        return this.message;
    }

    /**
     * List all attachments. Resulting attachment objects can be used as input for MimeNode nodes
     *
     * @param {Boolean} findRelated If true separate related attachments from attached ones
     * @returns {Object} An object of arrays (`related` and `attached`)
     */
    getAttachments(findRelated) {
        let icalEvent, eventObject;
        let attachments = [].concat(this.mail.attachments || []).map((attachment, i) => {
            let data;
            let isMessageNode = /^message\//i.test(attachment.contentType);

            if (/^data:/i.test(attachment.path || attachment.href)) {
                attachment = this._processDataUrl(attachment);
            }

            data = {
                contentType: attachment.contentType || mimeFuncs.detectMimeType(attachment.filename || attachment.path || attachment.href || 'bin'),
                contentDisposition: attachment.contentDisposition || (isMessageNode ? 'inline' : 'attachment'),
                contentTransferEncoding: 'contentTransferEncoding' in attachment ? attachment.contentTransferEncoding : 'base64'
            };

            if (attachment.filename) {
                data.filename = attachment.filename;
            } else if (!isMessageNode && attachment.filename !== false) {
                data.filename = (attachment.path || attachment.href || '').split('/').pop().split('?').shift() || 'attachment-' + (i + 1);
                if (data.filename.indexOf('.') < 0) {
                    data.filename += '.' + mimeFuncs.detectExtension(data.contentType);
                }
            }

            if (/^https?:\/\//i.test(attachment.path)) {
                attachment.href = attachment.path;
                attachment.path = undefined;
            }

            if (attachment.cid) {
                data.cid = attachment.cid;
            }

            if (attachment.raw) {
                data.raw = attachment.raw;
            } else if (attachment.path) {
                data.content = {
                    path: attachment.path
                };
            } else if (attachment.href) {
                data.content = {
                    href: attachment.href,
                    httpHeaders: attachment.httpHeaders
                };
            } else {
                data.content = attachment.content || '';
            }

            if (attachment.encoding) {
                data.encoding = attachment.encoding;
            }

            if (attachment.headers) {
                data.headers = attachment.headers;
            }

            return data;
        });

        if (this.mail.icalEvent) {
            if (
                typeof this.mail.icalEvent === 'object' &&
                (this.mail.icalEvent.content || this.mail.icalEvent.path || this.mail.icalEvent.href || this.mail.icalEvent.raw)
            ) {
                icalEvent = this.mail.icalEvent;
            } else {
                icalEvent = {
                    content: this.mail.icalEvent
                };
            }

            eventObject = {};
            Object.keys(icalEvent).forEach(key => {
                eventObject[key] = icalEvent[key];
            });

            eventObject.contentType = 'application/ics';
            if (!eventObject.headers) {
                eventObject.headers = {};
            }
            eventObject.filename = eventObject.filename || 'invite.ics';
            eventObject.headers['Content-Disposition'] = 'attachment';
            eventObject.headers['Content-Transfer-Encoding'] = 'base64';
        }

        if (!findRelated) {
            return {
                attached: attachments.concat(eventObject || []),
                related: []
            };
        } else {
            return {
                attached: attachments.filter(attachment => !attachment.cid).concat(eventObject || []),
                related: attachments.filter(attachment => !!attachment.cid)
            };
        }
    }

    /**
     * List alternatives. Resulting objects can be used as input for MimeNode nodes
     *
     * @returns {Array} An array of alternative elements. Includes the `text` and `html` values as well
     */
    getAlternatives() {
        let alternatives = [],
            text,
            html,
            watchHtml,
            amp,
            icalEvent,
            eventObject;

        if (this.mail.text) {
            if (typeof this.mail.text === 'object' && (this.mail.text.content || this.mail.text.path || this.mail.text.href || this.mail.text.raw)) {
                text = this.mail.text;
            } else {
                text = {
                    content: this.mail.text
                };
            }
            text.contentType = 'text/plain; charset=utf-8';
        }

        if (this.mail.watchHtml) {
            if (
                typeof this.mail.watchHtml === 'object' &&
                (this.mail.watchHtml.content || this.mail.watchHtml.path || this.mail.watchHtml.href || this.mail.watchHtml.raw)
            ) {
                watchHtml = this.mail.watchHtml;
            } else {
                watchHtml = {
                    content: this.mail.watchHtml
                };
            }
            watchHtml.contentType = 'text/watch-html; charset=utf-8';
        }

        if (this.mail.amp) {
            if (typeof this.mail.amp === 'object' && (this.mail.amp.content || this.mail.amp.path || this.mail.amp.href || this.mail.amp.raw)) {
                amp = this.mail.amp;
            } else {
                amp = {
                    content: this.mail.amp
                };
            }
            amp.contentType = 'text/x-amp-html; charset=utf-8';
        }

        // only include the calendar alternative if there are no attachments
        // otherwise you might end up in a blank screen on some clients
        if (this.mail.icalEvent && !(this.mail.attachments && this.mail.attachments.length)) {
            if (
                typeof this.mail.icalEvent === 'object' &&
                (this.mail.icalEvent.content || this.mail.icalEvent.path || this.mail.icalEvent.href || this.mail.icalEvent.raw)
            ) {
                icalEvent = this.mail.icalEvent;
            } else {
                icalEvent = {
                    content: this.mail.icalEvent
                };
            }

            eventObject = {};
            Object.keys(icalEvent).forEach(key => {
                eventObject[key] = icalEvent[key];
            });

            if (eventObject.content && typeof eventObject.content === 'object') {
                // we are going to have the same attachment twice, so mark this to be
                // resolved just once
                eventObject.content._resolve = true;
            }

            eventObject.filename = false;
            eventObject.contentType = 'text/calendar; charset=utf-8; method=' + (eventObject.method || 'PUBLISH').toString().trim().toUpperCase();
            if (!eventObject.headers) {
                eventObject.headers = {};
            }
        }

        if (this.mail.html) {
            if (typeof this.mail.html === 'object' && (this.mail.html.content || this.mail.html.path || this.mail.html.href || this.mail.html.raw)) {
                html = this.mail.html;
            } else {
                html = {
                    content: this.mail.html
                };
            }
            html.contentType = 'text/html; charset=utf-8';
        }

        []
            .concat(text || [])
            .concat(watchHtml || [])
            .concat(amp || [])
            .concat(html || [])
            .concat(eventObject || [])
            .concat(this.mail.alternatives || [])
            .forEach(alternative => {
                let data;

                if (/^data:/i.test(alternative.path || alternative.href)) {
                    alternative = this._processDataUrl(alternative);
                }

                data = {
                    contentType: alternative.contentType || mimeFuncs.detectMimeType(alternative.filename || alternative.path || alternative.href || 'txt'),
                    contentTransferEncoding: alternative.contentTransferEncoding
                };

                if (alternative.filename) {
                    data.filename = alternative.filename;
                }

                if (/^https?:\/\//i.test(alternative.path)) {
                    alternative.href = alternative.path;
                    alternative.path = undefined;
                }

                if (alternative.raw) {
                    data.raw = alternative.raw;
                } else if (alternative.path) {
                    data.content = {
                        path: alternative.path
                    };
                } else if (alternative.href) {
                    data.content = {
                        href: alternative.href
                    };
                } else {
                    data.content = alternative.content || '';
                }

                if (alternative.encoding) {
                    data.encoding = alternative.encoding;
                }

                if (alternative.headers) {
                    data.headers = alternative.headers;
                }

                alternatives.push(data);
            });

        return alternatives;
    }

    /**
     * Builds multipart/mixed node. It should always contain different type of elements on the same level
     * eg. text + attachments
     *
     * @param {Object} parentNode Parent for this note. If it does not exist, a root node is created
     * @returns {Object} MimeNode node element
     */
    _createMixed(parentNode) {
        let node;

        if (!parentNode) {
            node = new MimeNode('multipart/mixed', {
                baseBoundary: this.mail.baseBoundary,
                textEncoding: this.mail.textEncoding,
                boundaryPrefix: this.mail.boundaryPrefix,
                disableUrlAccess: this.mail.disableUrlAccess,
                disableFileAccess: this.mail.disableFileAccess,
                normalizeHeaderKey: this.mail.normalizeHeaderKey
            });
        } else {
            node = parentNode.createChild('multipart/mixed', {
                disableUrlAccess: this.mail.disableUrlAccess,
                disableFileAccess: this.mail.disableFileAccess,
                normalizeHeaderKey: this.mail.normalizeHeaderKey
            });
        }

        if (this._useAlternative) {
            this._createAlternative(node);
        } else if (this._useRelated) {
            this._createRelated(node);
        }

        []
            .concat((!this._useAlternative && this._alternatives) || [])
            .concat(this._attachments.attached || [])
            .forEach(element => {
                // if the element is a html node from related subpart then ignore it
                if (!this._useRelated || element !== this._htmlNode) {
                    this._createContentNode(node, element);
                }
            });

        return node;
    }

    /**
     * Builds multipart/alternative node. It should always contain same type of elements on the same level
     * eg. text + html view of the same data
     *
     * @param {Object} parentNode Parent for this note. If it does not exist, a root node is created
     * @returns {Object} MimeNode node element
     */
    _createAlternative(parentNode) {
        let node;

        if (!parentNode) {
            node = new MimeNode('multipart/alternative', {
                baseBoundary: this.mail.baseBoundary,
                textEncoding: this.mail.textEncoding,
                boundaryPrefix: this.mail.boundaryPrefix,
                disableUrlAccess: this.mail.disableUrlAccess,
                disableFileAccess: this.mail.disableFileAccess,
                normalizeHeaderKey: this.mail.normalizeHeaderKey
            });
        } else {
            node = parentNode.createChild('multipart/alternative', {
                disableUrlAccess: this.mail.disableUrlAccess,
                disableFileAccess: this.mail.disableFileAccess,
                normalizeHeaderKey: this.mail.normalizeHeaderKey
            });
        }

        this._alternatives.forEach(alternative => {
            if (this._useRelated && this._htmlNode === alternative) {
                this._createRelated(node);
            } else {
                this._createContentNode(node, alternative);
            }
        });

        return node;
    }

    /**
     * Builds multipart/related node. It should always contain html node with related attachments
     *
     * @param {Object} parentNode Parent for this note. If it does not exist, a root node is created
     * @returns {Object} MimeNode node element
     */
    _createRelated(parentNode) {
        let node;

        if (!parentNode) {
            node = new MimeNode('multipart/related; type="text/html"', {
                baseBoundary: this.mail.baseBoundary,
                textEncoding: this.mail.textEncoding,
                boundaryPrefix: this.mail.boundaryPrefix,
                disableUrlAccess: this.mail.disableUrlAccess,
                disableFileAccess: this.mail.disableFileAccess,
                normalizeHeaderKey: this.mail.normalizeHeaderKey
            });
        } else {
            node = parentNode.createChild('multipart/related; type="text/html"', {
                disableUrlAccess: this.mail.disableUrlAccess,
                disableFileAccess: this.mail.disableFileAccess,
                normalizeHeaderKey: this.mail.normalizeHeaderKey
            });
        }

        this._createContentNode(node, this._htmlNode);

        this._attachments.related.forEach(alternative => this._createContentNode(node, alternative));

        return node;
    }

    /**
     * Creates a regular node with contents
     *
     * @param {Object} parentNode Parent for this note. If it does not exist, a root node is created
     * @param {Object} element Node data
     * @returns {Object} MimeNode node element
     */
    _createContentNode(parentNode, element) {
        element = element || {};
        element.content = element.content || '';

        let node;
        let encoding = (element.encoding || 'utf8')
            .toString()
            .toLowerCase()
            .replace(/[-_\s]/g, '');

        if (!parentNode) {
            node = new MimeNode(element.contentType, {
                filename: element.filename,
                baseBoundary: this.mail.baseBoundary,
                textEncoding: this.mail.textEncoding,
                boundaryPrefix: this.mail.boundaryPrefix,
                disableUrlAccess: this.mail.disableUrlAccess,
                disableFileAccess: this.mail.disableFileAccess
            });
        } else {
            node = parentNode.createChild(element.contentType, {
                filename: element.filename,
                disableUrlAccess: this.mail.disableUrlAccess,
                disableFileAccess: this.mail.disableFileAccess,
                normalizeHeaderKey: this.mail.normalizeHeaderKey
            });
        }

        // add custom headers
        if (element.headers) {
            node.addHeader(element.headers);
        }

        if (element.cid) {
            node.setHeader('Content-Id', '<' + element.cid.replace(/[<>]/g, '') + '>');
        }

        if (element.contentTransferEncoding) {
            node.setHeader('Content-Transfer-Encoding', element.contentTransferEncoding);
        } else if (this.mail.encoding && /^text\//i.test(element.contentType)) {
            node.setHeader('Content-Transfer-Encoding', this.mail.encoding);
        }

        if (!/^text\//i.test(element.contentType) || element.contentDisposition) {
            node.setHeader('Content-Disposition', element.contentDisposition || (element.cid ? 'inline' : 'attachment'));
        }

        if (typeof element.content === 'string' && !['utf8', 'usascii', 'ascii'].includes(encoding)) {
            element.content = Buffer.from(element.content, encoding);
        }

        // prefer pregenerated raw content
        if (element.raw) {
            node.setRaw(element.raw);
        } else {
            node.setContent(element.content);
        }

        return node;
    }

    /**
     * Parses data uri and converts it to a Buffer
     *
     * @param {Object} element Content element
     * @return {Object} Parsed element
     */
    _processDataUrl(element) {
        let parts = (element.path || element.href).match(/^data:((?:[^;]*;)*(?:[^,]*)),(.*)$/i);
        if (!parts) {
            return element;
        }

        element.content = /\bbase64$/i.test(parts[1]) ? Buffer.from(parts[2], 'base64') : Buffer.from(decodeURIComponent(parts[2]));

        if ('path' in element) {
            element.path = false;
        }

        if ('href' in element) {
            element.href = false;
        }

        parts[1].split(';').forEach(item => {
            if (/^\w+\/[^/]+$/i.test(item)) {
                element.contentType = element.contentType || item.toLowerCase();
            }
        });

        return element;
    }
}

module.exports = MailComposer;


/***/ }),

/***/ 833:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";


const EventEmitter = __webpack_require__(8614);
const shared = __webpack_require__(2673);
const mimeTypes = __webpack_require__(7730);
const MailComposer = __webpack_require__(1694);
const DKIM = __webpack_require__(7757);
const httpProxyClient = __webpack_require__(2790);
const util = __webpack_require__(1669);
const urllib = __webpack_require__(8835);
const packageData = __webpack_require__(7643);
const MailMessage = __webpack_require__(5399);
const net = __webpack_require__(1631);
const dns = __webpack_require__(881);
const crypto = __webpack_require__(6417);

/**
 * Creates an object for exposing the Mail API
 *
 * @constructor
 * @param {Object} transporter Transport object instance to pass the mails to
 */
class Mail extends EventEmitter {
    constructor(transporter, options, defaults) {
        super();

        this.options = options || {};
        this._defaults = defaults || {};

        this._defaultPlugins = {
            compile: [(...args) => this._convertDataImages(...args)],
            stream: []
        };

        this._userPlugins = {
            compile: [],
            stream: []
        };

        this.meta = new Map();

        this.dkim = this.options.dkim ? new DKIM(this.options.dkim) : false;

        this.transporter = transporter;
        this.transporter.mailer = this;

        this.logger = shared.getLogger(this.options, {
            component: this.options.component || 'mail'
        });

        this.logger.debug(
            {
                tnx: 'create'
            },
            'Creating transport: %s',
            this.getVersionString()
        );

        // setup emit handlers for the transporter
        if (typeof this.transporter.on === 'function') {
            // deprecated log interface
            this.transporter.on('log', log => {
                this.logger.debug(
                    {
                        tnx: 'transport'
                    },
                    '%s: %s',
                    log.type,
                    log.message
                );
            });

            // transporter errors
            this.transporter.on('error', err => {
                this.logger.error(
                    {
                        err,
                        tnx: 'transport'
                    },
                    'Transport Error: %s',
                    err.message
                );
                this.emit('error', err);
            });

            // indicates if the sender has became idle
            this.transporter.on('idle', (...args) => {
                this.emit('idle', ...args);
            });
        }

        /**
         * Optional methods passed to the underlying transport object
         */
        ['close', 'isIdle', 'verify'].forEach(method => {
            this[method] = (...args) => {
                if (typeof this.transporter[method] === 'function') {
                    return this.transporter[method](...args);
                } else {
                    this.logger.warn(
                        {
                            tnx: 'transport',
                            methodName: method
                        },
                        'Non existing method %s called for transport',
                        method
                    );
                    return false;
                }
            };
        });

        // setup proxy handling
        if (this.options.proxy && typeof this.options.proxy === 'string') {
            this.setupProxy(this.options.proxy);
        }
    }

    use(step, plugin) {
        step = (step || '').toString();
        if (!this._userPlugins.hasOwnProperty(step)) {
            this._userPlugins[step] = [plugin];
        } else {
            this._userPlugins[step].push(plugin);
        }

        return this;
    }

    /**
     * Sends an email using the preselected transport object
     *
     * @param {Object} data E-data description
     * @param {Function?} callback Callback to run once the sending succeeded or failed
     */
    sendMail(data, callback) {
        let promise;

        if (!callback) {
            promise = new Promise((resolve, reject) => {
                callback = shared.callbackPromise(resolve, reject);
            });
        }

        if (typeof this.getSocket === 'function') {
            this.transporter.getSocket = this.getSocket;
            this.getSocket = false;
        }

        let mail = new MailMessage(this, data);

        this.logger.debug(
            {
                tnx: 'transport',
                name: this.transporter.name,
                version: this.transporter.version,
                action: 'send'
            },
            'Sending mail using %s/%s',
            this.transporter.name,
            this.transporter.version
        );

        this._processPlugins('compile', mail, err => {
            if (err) {
                this.logger.error(
                    {
                        err,
                        tnx: 'plugin',
                        action: 'compile'
                    },
                    'PluginCompile Error: %s',
                    err.message
                );
                return callback(err);
            }

            mail.message = new MailComposer(mail.data).compile();

            mail.setMailerHeader();
            mail.setPriorityHeaders();
            mail.setListHeaders();

            this._processPlugins('stream', mail, err => {
                if (err) {
                    this.logger.error(
                        {
                            err,
                            tnx: 'plugin',
                            action: 'stream'
                        },
                        'PluginStream Error: %s',
                        err.message
                    );
                    return callback(err);
                }

                if (mail.data.dkim || this.dkim) {
                    mail.message.processFunc(input => {
                        let dkim = mail.data.dkim ? new DKIM(mail.data.dkim) : this.dkim;
                        this.logger.debug(
                            {
                                tnx: 'DKIM',
                                messageId: mail.message.messageId(),
                                dkimDomains: dkim.keys.map(key => key.keySelector + '.' + key.domainName).join(', ')
                            },
                            'Signing outgoing message with %s keys',
                            dkim.keys.length
                        );
                        return dkim.sign(input, mail.data._dkim);
                    });
                }

                this.transporter.send(mail, (...args) => {
                    if (args[0]) {
                        this.logger.error(
                            {
                                err: args[0],
                                tnx: 'transport',
                                action: 'send'
                            },
                            'Send Error: %s',
                            args[0].message
                        );
                    }
                    callback(...args);
                });
            });
        });

        return promise;
    }

    getVersionString() {
        return util.format('%s (%s; +%s; %s/%s)', packageData.name, packageData.version, packageData.homepage, this.transporter.name, this.transporter.version);
    }

    _processPlugins(step, mail, callback) {
        step = (step || '').toString();

        if (!this._userPlugins.hasOwnProperty(step)) {
            return callback();
        }

        let userPlugins = this._userPlugins[step] || [];
        let defaultPlugins = this._defaultPlugins[step] || [];

        if (userPlugins.length) {
            this.logger.debug(
                {
                    tnx: 'transaction',
                    pluginCount: userPlugins.length,
                    step
                },
                'Using %s plugins for %s',
                userPlugins.length,
                step
            );
        }

        if (userPlugins.length + defaultPlugins.length === 0) {
            return callback();
        }

        let pos = 0;
        let block = 'default';
        let processPlugins = () => {
            let curplugins = block === 'default' ? defaultPlugins : userPlugins;
            if (pos >= curplugins.length) {
                if (block === 'default' && userPlugins.length) {
                    block = 'user';
                    pos = 0;
                    curplugins = userPlugins;
                } else {
                    return callback();
                }
            }
            let plugin = curplugins[pos++];
            plugin(mail, err => {
                if (err) {
                    return callback(err);
                }
                processPlugins();
            });
        };

        processPlugins();
    }

    /**
     * Sets up proxy handler for a Nodemailer object
     *
     * @param {String} proxyUrl Proxy configuration url
     */
    setupProxy(proxyUrl) {
        let proxy = urllib.parse(proxyUrl);

        // setup socket handler for the mailer object
        this.getSocket = (options, callback) => {
            let protocol = proxy.protocol.replace(/:$/, '').toLowerCase();

            if (this.meta.has('proxy_handler_' + protocol)) {
                return this.meta.get('proxy_handler_' + protocol)(proxy, options, callback);
            }

            switch (protocol) {
                // Connect using a HTTP CONNECT method
                case 'http':
                case 'https':
                    httpProxyClient(proxy.href, options.port, options.host, (err, socket) => {
                        if (err) {
                            return callback(err);
                        }
                        return callback(null, {
                            connection: socket
                        });
                    });
                    return;
                case 'socks':
                case 'socks5':
                case 'socks4':
                case 'socks4a': {
                    if (!this.meta.has('proxy_socks_module')) {
                        return callback(new Error('Socks module not loaded'));
                    }
                    let connect = ipaddress => {
                        let proxyV2 = !!this.meta.get('proxy_socks_module').SocksClient;
                        let socksClient = proxyV2 ? this.meta.get('proxy_socks_module').SocksClient : this.meta.get('proxy_socks_module');
                        let proxyType = Number(proxy.protocol.replace(/\D/g, '')) || 5;
                        let connectionOpts = {
                            proxy: {
                                ipaddress,
                                port: Number(proxy.port),
                                type: proxyType
                            },
                            [proxyV2 ? 'destination' : 'target']: {
                                host: options.host,
                                port: options.port
                            },
                            command: 'connect'
                        };

                        if (proxy.auth) {
                            let username = decodeURIComponent(proxy.auth.split(':').shift());
                            let password = decodeURIComponent(proxy.auth.split(':').pop());
                            if (proxyV2) {
                                connectionOpts.proxy.userId = username;
                                connectionOpts.proxy.password = password;
                            } else if (proxyType === 4) {
                                connectionOpts.userid = username;
                            } else {
                                connectionOpts.authentication = {
                                    username,
                                    password
                                };
                            }
                        }

                        socksClient.createConnection(connectionOpts, (err, info) => {
                            if (err) {
                                return callback(err);
                            }
                            return callback(null, {
                                connection: info.socket || info
                            });
                        });
                    };

                    if (net.isIP(proxy.hostname)) {
                        return connect(proxy.hostname);
                    }

                    return dns.resolve(proxy.hostname, (err, address) => {
                        if (err) {
                            return callback(err);
                        }
                        connect(Array.isArray(address) ? address[0] : address);
                    });
                }
            }
            callback(new Error('Unknown proxy configuration'));
        };
    }

    _convertDataImages(mail, callback) {
        if ((!this.options.attachDataUrls && !mail.data.attachDataUrls) || !mail.data.html) {
            return callback();
        }
        mail.resolveContent(mail.data, 'html', (err, html) => {
            if (err) {
                return callback(err);
            }
            let cidCounter = 0;
            html = (html || '').toString().replace(/(<img\b[^>]* src\s*=[\s"']*)(data:([^;]+);[^"'>\s]+)/gi, (match, prefix, dataUri, mimeType) => {
                let cid = crypto.randomBytes(10).toString('hex') + '@localhost';
                if (!mail.data.attachments) {
                    mail.data.attachments = [];
                }
                if (!Array.isArray(mail.data.attachments)) {
                    mail.data.attachments = [].concat(mail.data.attachments || []);
                }
                mail.data.attachments.push({
                    path: dataUri,
                    cid,
                    filename: 'image-' + ++cidCounter + '.' + mimeTypes.detectExtension(mimeType)
                });
                return prefix + 'cid:' + cid;
            });
            mail.data.html = html;
            callback();
        });
    }

    set(key, value) {
        return this.meta.set(key, value);
    }

    get(key) {
        return this.meta.get(key);
    }
}

module.exports = Mail;


/***/ }),

/***/ 5399:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";


const shared = __webpack_require__(2673);
const MimeNode = __webpack_require__(8509);
const mimeFuncs = __webpack_require__(994);

class MailMessage {
    constructor(mailer, data) {
        this.mailer = mailer;
        this.data = {};
        this.message = null;

        data = data || {};
        let options = mailer.options || {};
        let defaults = mailer._defaults || {};

        Object.keys(data).forEach(key => {
            this.data[key] = data[key];
        });

        this.data.headers = this.data.headers || {};

        // apply defaults
        Object.keys(defaults).forEach(key => {
            if (!(key in this.data)) {
                this.data[key] = defaults[key];
            } else if (key === 'headers') {
                // headers is a special case. Allow setting individual default headers
                Object.keys(defaults.headers).forEach(key => {
                    if (!(key in this.data.headers)) {
                        this.data.headers[key] = defaults.headers[key];
                    }
                });
            }
        });

        // force specific keys from transporter options
        ['disableFileAccess', 'disableUrlAccess', 'normalizeHeaderKey'].forEach(key => {
            if (key in options) {
                this.data[key] = options[key];
            }
        });
    }

    resolveContent(...args) {
        return shared.resolveContent(...args);
    }

    resolveAll(callback) {
        let keys = [
            [this.data, 'html'],
            [this.data, 'text'],
            [this.data, 'watchHtml'],
            [this.data, 'amp'],
            [this.data, 'icalEvent']
        ];

        if (this.data.alternatives && this.data.alternatives.length) {
            this.data.alternatives.forEach((alternative, i) => {
                keys.push([this.data.alternatives, i]);
            });
        }

        if (this.data.attachments && this.data.attachments.length) {
            this.data.attachments.forEach((attachment, i) => {
                if (!attachment.filename) {
                    attachment.filename =
                        (attachment.path || attachment.href || '')
                            .split('/')
                            .pop()
                            .split('?')
                            .shift() || 'attachment-' + (i + 1);
                    if (attachment.filename.indexOf('.') < 0) {
                        attachment.filename += '.' + mimeFuncs.detectExtension(attachment.contentType);
                    }
                }

                if (!attachment.contentType) {
                    attachment.contentType = mimeFuncs.detectMimeType(attachment.filename || attachment.path || attachment.href || 'bin');
                }

                keys.push([this.data.attachments, i]);
            });
        }

        let mimeNode = new MimeNode();

        let addressKeys = ['from', 'to', 'cc', 'bcc', 'sender', 'replyTo'];

        addressKeys.forEach(address => {
            let value;
            if (this.message) {
                value = [].concat(mimeNode._parseAddresses(this.message.getHeader(address === 'replyTo' ? 'reply-to' : address)) || []);
            } else if (this.data[address]) {
                value = [].concat(mimeNode._parseAddresses(this.data[address]) || []);
            }
            if (value && value.length) {
                this.data[address] = value;
            } else if (address in this.data) {
                this.data[address] = null;
            }
        });

        let singleKeys = ['from', 'sender', 'replyTo'];
        singleKeys.forEach(address => {
            if (this.data[address]) {
                this.data[address] = this.data[address].shift();
            }
        });

        let pos = 0;
        let resolveNext = () => {
            if (pos >= keys.length) {
                return callback(null, this.data);
            }
            let args = keys[pos++];
            if (!args[0] || !args[0][args[1]]) {
                return resolveNext();
            }
            shared.resolveContent(...args, (err, value) => {
                if (err) {
                    return callback(err);
                }

                let node = {
                    content: value
                };
                if (args[0][args[1]] && typeof args[0][args[1]] === 'object' && !Buffer.isBuffer(args[0][args[1]])) {
                    Object.keys(args[0][args[1]]).forEach(key => {
                        if (!(key in node) && !['content', 'path', 'href', 'raw'].includes(key)) {
                            node[key] = args[0][args[1]][key];
                        }
                    });
                }

                args[0][args[1]] = node;
                resolveNext();
            });
        };

        setImmediate(() => resolveNext());
    }

    normalize(callback) {
        let envelope = this.data.envelope || this.message.getEnvelope();
        let messageId = this.message.messageId();

        this.resolveAll((err, data) => {
            if (err) {
                return callback(err);
            }

            data.envelope = envelope;
            data.messageId = messageId;

            ['html', 'text', 'watchHtml', 'amp'].forEach(key => {
                if (data[key] && data[key].content) {
                    if (typeof data[key].content === 'string') {
                        data[key] = data[key].content;
                    } else if (Buffer.isBuffer(data[key].content)) {
                        data[key] = data[key].content.toString();
                    }
                }
            });

            if (data.icalEvent && Buffer.isBuffer(data.icalEvent.content)) {
                data.icalEvent.content = data.icalEvent.content.toString('base64');
                data.icalEvent.encoding = 'base64';
            }

            if (data.alternatives && data.alternatives.length) {
                data.alternatives.forEach(alternative => {
                    if (alternative && alternative.content && Buffer.isBuffer(alternative.content)) {
                        alternative.content = alternative.content.toString('base64');
                        alternative.encoding = 'base64';
                    }
                });
            }

            if (data.attachments && data.attachments.length) {
                data.attachments.forEach(attachment => {
                    if (attachment && attachment.content && Buffer.isBuffer(attachment.content)) {
                        attachment.content = attachment.content.toString('base64');
                        attachment.encoding = 'base64';
                    }
                });
            }

            data.normalizedHeaders = {};
            Object.keys(data.headers || {}).forEach(key => {
                let value = [].concat(data.headers[key] || []).shift();
                value = (value && value.value) || value;
                if (value) {
                    if (['references', 'in-reply-to', 'message-id', 'content-id'].includes(key)) {
                        value = this.message._encodeHeaderValue(key, value);
                    }
                    data.normalizedHeaders[key] = value;
                }
            });

            if (data.list && typeof data.list === 'object') {
                let listHeaders = this._getListHeaders(data.list);
                listHeaders.forEach(entry => {
                    data.normalizedHeaders[entry.key] = entry.value.map(val => (val && val.value) || val).join(', ');
                });
            }

            if (data.references) {
                data.normalizedHeaders.references = this.message._encodeHeaderValue('references', data.references);
            }

            if (data.inReplyTo) {
                data.normalizedHeaders['in-reply-to'] = this.message._encodeHeaderValue('in-reply-to', data.inReplyTo);
            }

            return callback(null, data);
        });
    }

    setMailerHeader() {
        if (!this.message || !this.data.xMailer) {
            return;
        }
        this.message.setHeader('X-Mailer', this.data.xMailer);
    }

    setPriorityHeaders() {
        if (!this.message || !this.data.priority) {
            return;
        }
        switch ((this.data.priority || '').toString().toLowerCase()) {
            case 'high':
                this.message.setHeader('X-Priority', '1 (Highest)');
                this.message.setHeader('X-MSMail-Priority', 'High');
                this.message.setHeader('Importance', 'High');
                break;
            case 'low':
                this.message.setHeader('X-Priority', '5 (Lowest)');
                this.message.setHeader('X-MSMail-Priority', 'Low');
                this.message.setHeader('Importance', 'Low');
                break;
            default:
            // do not add anything, since all messages are 'Normal' by default
        }
    }

    setListHeaders() {
        if (!this.message || !this.data.list || typeof this.data.list !== 'object') {
            return;
        }
        // add optional List-* headers
        if (this.data.list && typeof this.data.list === 'object') {
            this._getListHeaders(this.data.list).forEach(listHeader => {
                listHeader.value.forEach(value => {
                    this.message.addHeader(listHeader.key, value);
                });
            });
        }
    }

    _getListHeaders(listData) {
        // make sure an url looks like <protocol:url>
        return Object.keys(listData).map(key => ({
            key: 'list-' + key.toLowerCase().trim(),
            value: [].concat(listData[key] || []).map(value => ({
                prepared: true,
                foldLines: true,
                value: []
                    .concat(value || [])
                    .map(value => {
                        if (typeof value === 'string') {
                            value = {
                                url: value
                            };
                        }

                        if (value && value.url) {
                            if (key.toLowerCase().trim() === 'id') {
                                // List-ID: "comment" <domain>
                                let comment = value.comment || '';
                                if (mimeFuncs.isPlainText(comment)) {
                                    comment = '"' + comment + '"';
                                } else {
                                    comment = mimeFuncs.encodeWord(comment);
                                }

                                return (value.comment ? comment + ' ' : '') + this._formatListUrl(value.url).replace(/^<[^:]+\/{,2}/, '');
                            }

                            // List-*: <http://domain> (comment)
                            let comment = value.comment || '';
                            if (!mimeFuncs.isPlainText(comment)) {
                                comment = mimeFuncs.encodeWord(comment);
                            }

                            return this._formatListUrl(value.url) + (value.comment ? ' (' + comment + ')' : '');
                        }

                        return '';
                    })
                    .filter(value => value)
                    .join(', ')
            }))
        }));
    }

    _formatListUrl(url) {
        url = url.replace(/[\s<]+|[\s>]+/g, '');
        if (/^(https?|mailto|ftp):/.test(url)) {
            return '<' + url + '>';
        }
        if (/^[^@]+@[^@]+$/.test(url)) {
            return '<mailto:' + url + '>';
        }

        return '<http://' + url + '>';
    }
}

module.exports = MailMessage;


/***/ }),

/***/ 994:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";
/* eslint no-control-regex:0 */



const base64 = __webpack_require__(4017);
const qp = __webpack_require__(9716);
const mimeTypes = __webpack_require__(7730);

module.exports = {
    /**
     * Checks if a value is plaintext string (uses only printable 7bit chars)
     *
     * @param {String} value String to be tested
     * @returns {Boolean} true if it is a plaintext string
     */
    isPlainText(value) {
        if (typeof value !== 'string' || /[\x00-\x08\x0b\x0c\x0e-\x1f\u0080-\uFFFF]/.test(value)) {
            return false;
        } else {
            return true;
        }
    },

    /**
     * Checks if a multi line string containes lines longer than the selected value.
     *
     * Useful when detecting if a mail message needs any processing at all ???
     * if only plaintext characters are used and lines are short, then there is
     * no need to encode the values in any way. If the value is plaintext but has
     * longer lines then allowed, then use format=flowed
     *
     * @param {Number} lineLength Max line length to check for
     * @returns {Boolean} Returns true if there is at least one line longer than lineLength chars
     */
    hasLongerLines(str, lineLength) {
        if (str.length > 128 * 1024) {
            // do not test strings longer than 128kB
            return true;
        }
        return new RegExp('^.{' + (lineLength + 1) + ',}', 'm').test(str);
    },

    /**
     * Encodes a string or an Buffer to an UTF-8 MIME Word (rfc2047)
     *
     * @param {String|Buffer} data String to be encoded
     * @param {String} mimeWordEncoding='Q' Encoding for the mime word, either Q or B
     * @param {Number} [maxLength=0] If set, split mime words into several chunks if needed
     * @return {String} Single or several mime words joined together
     */
    encodeWord(data, mimeWordEncoding, maxLength) {
        mimeWordEncoding = (mimeWordEncoding || 'Q')
            .toString()
            .toUpperCase()
            .trim()
            .charAt(0);
        maxLength = maxLength || 0;

        let encodedStr;
        let toCharset = 'UTF-8';

        if (maxLength && maxLength > 7 + toCharset.length) {
            maxLength -= 7 + toCharset.length;
        }

        if (mimeWordEncoding === 'Q') {
            // https://tools.ietf.org/html/rfc2047#section-5 rule (3)
            encodedStr = qp.encode(data).replace(/[^a-z0-9!*+\-/=]/gi, chr => {
                let ord = chr
                    .charCodeAt(0)
                    .toString(16)
                    .toUpperCase();
                if (chr === ' ') {
                    return '_';
                } else {
                    return '=' + (ord.length === 1 ? '0' + ord : ord);
                }
            });
        } else if (mimeWordEncoding === 'B') {
            encodedStr = typeof data === 'string' ? data : base64.encode(data);
            maxLength = maxLength ? Math.max(3, ((maxLength - (maxLength % 4)) / 4) * 3) : 0;
        }

        if (maxLength && (mimeWordEncoding !== 'B' ? encodedStr : base64.encode(data)).length > maxLength) {
            if (mimeWordEncoding === 'Q') {
                encodedStr = this.splitMimeEncodedString(encodedStr, maxLength).join('?= =?' + toCharset + '?' + mimeWordEncoding + '?');
            } else {
                // RFC2047 6.3 (2) states that encoded-word must include an integral number of characters, so no chopping unicode sequences
                let parts = [];
                let lpart = '';
                for (let i = 0, len = encodedStr.length; i < len; i++) {
                    let chr = encodedStr.charAt(i);
                    // check if we can add this character to the existing string
                    // without breaking byte length limit
                    if (Buffer.byteLength(lpart + chr) <= maxLength || i === 0) {
                        lpart += chr;
                    } else {
                        // we hit the length limit, so push the existing string and start over
                        parts.push(base64.encode(lpart));
                        lpart = chr;
                    }
                }
                if (lpart) {
                    parts.push(base64.encode(lpart));
                }

                if (parts.length > 1) {
                    encodedStr = parts.join('?= =?' + toCharset + '?' + mimeWordEncoding + '?');
                } else {
                    encodedStr = parts.join('');
                }
            }
        } else if (mimeWordEncoding === 'B') {
            encodedStr = base64.encode(data);
        }

        return '=?' + toCharset + '?' + mimeWordEncoding + '?' + encodedStr + (encodedStr.substr(-2) === '?=' ? '' : '?=');
    },

    /**
     * Finds word sequences with non ascii text and converts these to mime words
     *
     * @param {String} value String to be encoded
     * @param {String} mimeWordEncoding='Q' Encoding for the mime word, either Q or B
     * @param {Number} [maxLength=0] If set, split mime words into several chunks if needed
     * @param {Boolean} [encodeAll=false] If true and the value needs encoding then encodes entire string, not just the smallest match
     * @return {String} String with possible mime words
     */
    encodeWords(value, mimeWordEncoding, maxLength, encodeAll) {
        maxLength = maxLength || 0;

        let encodedValue;

        // find first word with a non-printable ascii in it
        let firstMatch = value.match(/(?:^|\s)([^\s]*[\u0080-\uFFFF])/);
        if (!firstMatch) {
            return value;
        }

        if (encodeAll) {
            // if it is requested to encode everything or the string contains something that resebles encoded word, then encode everything

            return this.encodeWord(value, mimeWordEncoding, maxLength);
        }

        // find the last word with a non-printable ascii in it
        let lastMatch = value.match(/([\u0080-\uFFFF][^\s]*)[^\u0080-\uFFFF]*$/);
        if (!lastMatch) {
            // should not happen
            return value;
        }

        let startIndex =
            firstMatch.index +
            (
                firstMatch[0].match(/[^\s]/) || {
                    index: 0
                }
            ).index;
        let endIndex = lastMatch.index + (lastMatch[1] || '').length;

        encodedValue =
            (startIndex ? value.substr(0, startIndex) : '') +
            this.encodeWord(value.substring(startIndex, endIndex), mimeWordEncoding || 'Q', maxLength) +
            (endIndex < value.length ? value.substr(endIndex) : '');

        return encodedValue;
    },

    /**
     * Joins parsed header value together as 'value; param1=value1; param2=value2'
     * PS: We are following RFC 822 for the list of special characters that we need to keep in quotes.
     *      Refer: https://www.w3.org/Protocols/rfc1341/4_Content-Type.html
     * @param {Object} structured Parsed header value
     * @return {String} joined header value
     */
    buildHeaderValue(structured) {
        let paramsArray = [];

        Object.keys(structured.params || {}).forEach(param => {
            // filename might include unicode characters so it is a special case
            // other values probably do not
            let value = structured.params[param];
            if (!this.isPlainText(value) || value.length >= 75) {
                this.buildHeaderParam(param, value, 50).forEach(encodedParam => {
                    if (!/[\s"\\;:/=(),<>@[\]?]|^[-']|'$/.test(encodedParam.value) || encodedParam.key.substr(-1) === '*') {
                        paramsArray.push(encodedParam.key + '=' + encodedParam.value);
                    } else {
                        paramsArray.push(encodedParam.key + '=' + JSON.stringify(encodedParam.value));
                    }
                });
            } else if (/[\s'"\\;:/=(),<>@[\]?]|^-/.test(value)) {
                paramsArray.push(param + '=' + JSON.stringify(value));
            } else {
                paramsArray.push(param + '=' + value);
            }
        });

        return structured.value + (paramsArray.length ? '; ' + paramsArray.join('; ') : '');
    },

    /**
     * Encodes a string or an Buffer to an UTF-8 Parameter Value Continuation encoding (rfc2231)
     * Useful for splitting long parameter values.
     *
     * For example
     *      title="unicode string"
     * becomes
     *     title*0*=utf-8''unicode
     *     title*1*=%20string
     *
     * @param {String|Buffer} data String to be encoded
     * @param {Number} [maxLength=50] Max length for generated chunks
     * @param {String} [fromCharset='UTF-8'] Source sharacter set
     * @return {Array} A list of encoded keys and headers
     */
    buildHeaderParam(key, data, maxLength) {
        let list = [];
        let encodedStr = typeof data === 'string' ? data : (data || '').toString();
        let encodedStrArr;
        let chr, ord;
        let line;
        let startPos = 0;
        let i, len;

        maxLength = maxLength || 50;

        // process ascii only text
        if (this.isPlainText(data)) {
            // check if conversion is even needed
            if (encodedStr.length <= maxLength) {
                return [
                    {
                        key,
                        value: encodedStr
                    }
                ];
            }

            encodedStr = encodedStr.replace(new RegExp('.{' + maxLength + '}', 'g'), str => {
                list.push({
                    line: str
                });
                return '';
            });

            if (encodedStr) {
                list.push({
                    line: encodedStr
                });
            }
        } else {
            if (/[\uD800-\uDBFF]/.test(encodedStr)) {
                // string containts surrogate pairs, so normalize it to an array of bytes
                encodedStrArr = [];
                for (i = 0, len = encodedStr.length; i < len; i++) {
                    chr = encodedStr.charAt(i);
                    ord = chr.charCodeAt(0);
                    if (ord >= 0xd800 && ord <= 0xdbff && i < len - 1) {
                        chr += encodedStr.charAt(i + 1);
                        encodedStrArr.push(chr);
                        i++;
                    } else {
                        encodedStrArr.push(chr);
                    }
                }
                encodedStr = encodedStrArr;
            }

            // first line includes the charset and language info and needs to be encoded
            // even if it does not contain any unicode characters
            line = 'utf-8\x27\x27';
            let encoded = true;
            startPos = 0;

            // process text with unicode or special chars
            for (i = 0, len = encodedStr.length; i < len; i++) {
                chr = encodedStr[i];

                if (encoded) {
                    chr = this.safeEncodeURIComponent(chr);
                } else {
                    // try to urlencode current char
                    chr = chr === ' ' ? chr : this.safeEncodeURIComponent(chr);
                    // By default it is not required to encode a line, the need
                    // only appears when the string contains unicode or special chars
                    // in this case we start processing the line over and encode all chars
                    if (chr !== encodedStr[i]) {
                        // Check if it is even possible to add the encoded char to the line
                        // If not, there is no reason to use this line, just push it to the list
                        // and start a new line with the char that needs encoding
                        if ((this.safeEncodeURIComponent(line) + chr).length >= maxLength) {
                            list.push({
                                line,
                                encoded
                            });
                            line = '';
                            startPos = i - 1;
                        } else {
                            encoded = true;
                            i = startPos;
                            line = '';
                            continue;
                        }
                    }
                }

                // if the line is already too long, push it to the list and start a new one
                if ((line + chr).length >= maxLength) {
                    list.push({
                        line,
                        encoded
                    });
                    line = chr = encodedStr[i] === ' ' ? ' ' : this.safeEncodeURIComponent(encodedStr[i]);
                    if (chr === encodedStr[i]) {
                        encoded = false;
                        startPos = i - 1;
                    } else {
                        encoded = true;
                    }
                } else {
                    line += chr;
                }
            }

            if (line) {
                list.push({
                    line,
                    encoded
                });
            }
        }

        return list.map((item, i) => ({
            // encoded lines: {name}*{part}*
            // unencoded lines: {name}*{part}
            // if any line needs to be encoded then the first line (part==0) is always encoded
            key: key + '*' + i + (item.encoded ? '*' : ''),
            value: item.line
        }));
    },

    /**
     * Parses a header value with key=value arguments into a structured
     * object.
     *
     *   parseHeaderValue('content-type: text/plain; CHARSET='UTF-8'') ->
     *   {
     *     'value': 'text/plain',
     *     'params': {
     *       'charset': 'UTF-8'
     *     }
     *   }
     *
     * @param {String} str Header value
     * @return {Object} Header value as a parsed structure
     */
    parseHeaderValue(str) {
        let response = {
            value: false,
            params: {}
        };
        let key = false;
        let value = '';
        let type = 'value';
        let quote = false;
        let escaped = false;
        let chr;

        for (let i = 0, len = str.length; i < len; i++) {
            chr = str.charAt(i);
            if (type === 'key') {
                if (chr === '=') {
                    key = value.trim().toLowerCase();
                    type = 'value';
                    value = '';
                    continue;
                }
                value += chr;
            } else {
                if (escaped) {
                    value += chr;
                } else if (chr === '\\') {
                    escaped = true;
                    continue;
                } else if (quote && chr === quote) {
                    quote = false;
                } else if (!quote && chr === '"') {
                    quote = chr;
                } else if (!quote && chr === ';') {
                    if (key === false) {
                        response.value = value.trim();
                    } else {
                        response.params[key] = value.trim();
                    }
                    type = 'key';
                    value = '';
                } else {
                    value += chr;
                }
                escaped = false;
            }
        }

        if (type === 'value') {
            if (key === false) {
                response.value = value.trim();
            } else {
                response.params[key] = value.trim();
            }
        } else if (value.trim()) {
            response.params[value.trim().toLowerCase()] = '';
        }

        // handle parameter value continuations
        // https://tools.ietf.org/html/rfc2231#section-3

        // preprocess values
        Object.keys(response.params).forEach(key => {
            let actualKey, nr, match, value;
            if ((match = key.match(/(\*(\d+)|\*(\d+)\*|\*)$/))) {
                actualKey = key.substr(0, match.index);
                nr = Number(match[2] || match[3]) || 0;

                if (!response.params[actualKey] || typeof response.params[actualKey] !== 'object') {
                    response.params[actualKey] = {
                        charset: false,
                        values: []
                    };
                }

                value = response.params[key];

                if (nr === 0 && match[0].substr(-1) === '*' && (match = value.match(/^([^']*)'[^']*'(.*)$/))) {
                    response.params[actualKey].charset = match[1] || 'iso-8859-1';
                    value = match[2];
                }

                response.params[actualKey].values[nr] = value;

                // remove the old reference
                delete response.params[key];
            }
        });

        // concatenate split rfc2231 strings and convert encoded strings to mime encoded words
        Object.keys(response.params).forEach(key => {
            let value;
            if (response.params[key] && Array.isArray(response.params[key].values)) {
                value = response.params[key].values.map(val => val || '').join('');

                if (response.params[key].charset) {
                    // convert "%AB" to "=?charset?Q?=AB?="
                    response.params[key] =
                        '=?' +
                        response.params[key].charset +
                        '?Q?' +
                        value
                            // fix invalidly encoded chars
                            .replace(/[=?_\s]/g, s => {
                                let c = s.charCodeAt(0).toString(16);
                                if (s === ' ') {
                                    return '_';
                                } else {
                                    return '%' + (c.length < 2 ? '0' : '') + c;
                                }
                            })
                            // change from urlencoding to percent encoding
                            .replace(/%/g, '=') +
                        '?=';
                } else {
                    response.params[key] = value;
                }
            }
        });

        return response;
    },

    /**
     * Returns file extension for a content type string. If no suitable extensions
     * are found, 'bin' is used as the default extension
     *
     * @param {String} mimeType Content type to be checked for
     * @return {String} File extension
     */
    detectExtension: mimeType => mimeTypes.detectExtension(mimeType),

    /**
     * Returns content type for a file extension. If no suitable content types
     * are found, 'application/octet-stream' is used as the default content type
     *
     * @param {String} extension Extension to be checked for
     * @return {String} File extension
     */
    detectMimeType: extension => mimeTypes.detectMimeType(extension),

    /**
     * Folds long lines, useful for folding header lines (afterSpace=false) and
     * flowed text (afterSpace=true)
     *
     * @param {String} str String to be folded
     * @param {Number} [lineLength=76] Maximum length of a line
     * @param {Boolean} afterSpace If true, leave a space in th end of a line
     * @return {String} String with folded lines
     */
    foldLines(str, lineLength, afterSpace) {
        str = (str || '').toString();
        lineLength = lineLength || 76;

        let pos = 0,
            len = str.length,
            result = '',
            line,
            match;

        while (pos < len) {
            line = str.substr(pos, lineLength);
            if (line.length < lineLength) {
                result += line;
                break;
            }
            if ((match = line.match(/^[^\n\r]*(\r?\n|\r)/))) {
                line = match[0];
                result += line;
                pos += line.length;
                continue;
            } else if ((match = line.match(/(\s+)[^\s]*$/)) && match[0].length - (afterSpace ? (match[1] || '').length : 0) < line.length) {
                line = line.substr(0, line.length - (match[0].length - (afterSpace ? (match[1] || '').length : 0)));
            } else if ((match = str.substr(pos + line.length).match(/^[^\s]+(\s*)/))) {
                line = line + match[0].substr(0, match[0].length - (!afterSpace ? (match[1] || '').length : 0));
            }

            result += line;
            pos += line.length;
            if (pos < len) {
                result += '\r\n';
            }
        }

        return result;
    },

    /**
     * Splits a mime encoded string. Needed for dividing mime words into smaller chunks
     *
     * @param {String} str Mime encoded string to be split up
     * @param {Number} maxlen Maximum length of characters for one part (minimum 12)
     * @return {Array} Split string
     */
    splitMimeEncodedString: (str, maxlen) => {
        let curLine,
            match,
            chr,
            done,
            lines = [];

        // require at least 12 symbols to fit possible 4 octet UTF-8 sequences
        maxlen = Math.max(maxlen || 0, 12);

        while (str.length) {
            curLine = str.substr(0, maxlen);

            // move incomplete escaped char back to main
            if ((match = curLine.match(/[=][0-9A-F]?$/i))) {
                curLine = curLine.substr(0, match.index);
            }

            done = false;
            while (!done) {
                done = true;
                // check if not middle of a unicode char sequence
                if ((match = str.substr(curLine.length).match(/^[=]([0-9A-F]{2})/i))) {
                    chr = parseInt(match[1], 16);
                    // invalid sequence, move one char back anc recheck
                    if (chr < 0xc2 && chr > 0x7f) {
                        curLine = curLine.substr(0, curLine.length - 3);
                        done = false;
                    }
                }
            }

            if (curLine.length) {
                lines.push(curLine);
            }
            str = str.substr(curLine.length);
        }

        return lines;
    },

    encodeURICharComponent: chr => {
        let res = '';
        let ord = chr
            .charCodeAt(0)
            .toString(16)
            .toUpperCase();

        if (ord.length % 2) {
            ord = '0' + ord;
        }

        if (ord.length > 2) {
            for (let i = 0, len = ord.length / 2; i < len; i++) {
                res += '%' + ord.substr(i, 2);
            }
        } else {
            res += '%' + ord;
        }

        return res;
    },

    safeEncodeURIComponent(str) {
        str = (str || '').toString();

        try {
            // might throw if we try to encode invalid sequences, eg. partial emoji
            str = encodeURIComponent(str);
        } catch (E) {
            // should never run
            return str.replace(/[^\x00-\x1F *'()<>@,;:\\"[\]?=\u007F-\uFFFF]+/g, '');
        }

        // ensure chars that are not handled by encodeURICompent are converted as well
        return str.replace(/[\x00-\x1F *'()<>@,;:\\"[\]?=\u007F-\uFFFF]/g, chr => this.encodeURICharComponent(chr));
    }
};


/***/ }),

/***/ 7730:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";
/* eslint quote-props: 0 */



const path = __webpack_require__(5622);

const defaultMimeType = 'application/octet-stream';
const defaultExtension = 'bin';

const mimeTypes = new Map([
    ['application/acad', 'dwg'],
    ['application/applixware', 'aw'],
    ['application/arj', 'arj'],
    ['application/atom+xml', 'xml'],
    ['application/atomcat+xml', 'atomcat'],
    ['application/atomsvc+xml', 'atomsvc'],
    ['application/base64', ['mm', 'mme']],
    ['application/binhex', 'hqx'],
    ['application/binhex4', 'hqx'],
    ['application/book', ['book', 'boo']],
    ['application/ccxml+xml,', 'ccxml'],
    ['application/cdf', 'cdf'],
    ['application/cdmi-capability', 'cdmia'],
    ['application/cdmi-container', 'cdmic'],
    ['application/cdmi-domain', 'cdmid'],
    ['application/cdmi-object', 'cdmio'],
    ['application/cdmi-queue', 'cdmiq'],
    ['application/clariscad', 'ccad'],
    ['application/commonground', 'dp'],
    ['application/cu-seeme', 'cu'],
    ['application/davmount+xml', 'davmount'],
    ['application/drafting', 'drw'],
    ['application/dsptype', 'tsp'],
    ['application/dssc+der', 'dssc'],
    ['application/dssc+xml', 'xdssc'],
    ['application/dxf', 'dxf'],
    ['application/ecmascript', ['js', 'es']],
    ['application/emma+xml', 'emma'],
    ['application/envoy', 'evy'],
    ['application/epub+zip', 'epub'],
    ['application/excel', ['xls', 'xl', 'xla', 'xlb', 'xlc', 'xld', 'xlk', 'xll', 'xlm', 'xlt', 'xlv', 'xlw']],
    ['application/exi', 'exi'],
    ['application/font-tdpfr', 'pfr'],
    ['application/fractals', 'fif'],
    ['application/freeloader', 'frl'],
    ['application/futuresplash', 'spl'],
    ['application/gnutar', 'tgz'],
    ['application/groupwise', 'vew'],
    ['application/hlp', 'hlp'],
    ['application/hta', 'hta'],
    ['application/hyperstudio', 'stk'],
    ['application/i-deas', 'unv'],
    ['application/iges', ['iges', 'igs']],
    ['application/inf', 'inf'],
    ['application/internet-property-stream', 'acx'],
    ['application/ipfix', 'ipfix'],
    ['application/java', 'class'],
    ['application/java-archive', 'jar'],
    ['application/java-byte-code', 'class'],
    ['application/java-serialized-object', 'ser'],
    ['application/java-vm', 'class'],
    ['application/javascript', 'js'],
    ['application/json', 'json'],
    ['application/lha', 'lha'],
    ['application/lzx', 'lzx'],
    ['application/mac-binary', 'bin'],
    ['application/mac-binhex', 'hqx'],
    ['application/mac-binhex40', 'hqx'],
    ['application/mac-compactpro', 'cpt'],
    ['application/macbinary', 'bin'],
    ['application/mads+xml', 'mads'],
    ['application/marc', 'mrc'],
    ['application/marcxml+xml', 'mrcx'],
    ['application/mathematica', 'ma'],
    ['application/mathml+xml', 'mathml'],
    ['application/mbedlet', 'mbd'],
    ['application/mbox', 'mbox'],
    ['application/mcad', 'mcd'],
    ['application/mediaservercontrol+xml', 'mscml'],
    ['application/metalink4+xml', 'meta4'],
    ['application/mets+xml', 'mets'],
    ['application/mime', 'aps'],
    ['application/mods+xml', 'mods'],
    ['application/mp21', 'm21'],
    ['application/mp4', 'mp4'],
    ['application/mspowerpoint', ['ppt', 'pot', 'pps', 'ppz']],
    ['application/msword', ['doc', 'dot', 'w6w', 'wiz', 'word']],
    ['application/mswrite', 'wri'],
    ['application/mxf', 'mxf'],
    ['application/netmc', 'mcp'],
    ['application/octet-stream', ['*']],
    ['application/oda', 'oda'],
    ['application/oebps-package+xml', 'opf'],
    ['application/ogg', 'ogx'],
    ['application/olescript', 'axs'],
    ['application/onenote', 'onetoc'],
    ['application/patch-ops-error+xml', 'xer'],
    ['application/pdf', 'pdf'],
    ['application/pgp-encrypted', 'asc'],
    ['application/pgp-signature', 'pgp'],
    ['application/pics-rules', 'prf'],
    ['application/pkcs-12', 'p12'],
    ['application/pkcs-crl', 'crl'],
    ['application/pkcs10', 'p10'],
    ['application/pkcs7-mime', ['p7c', 'p7m']],
    ['application/pkcs7-signature', 'p7s'],
    ['application/pkcs8', 'p8'],
    ['application/pkix-attr-cert', 'ac'],
    ['application/pkix-cert', ['cer', 'crt']],
    ['application/pkix-crl', 'crl'],
    ['application/pkix-pkipath', 'pkipath'],
    ['application/pkixcmp', 'pki'],
    ['application/plain', 'text'],
    ['application/pls+xml', 'pls'],
    ['application/postscript', ['ps', 'ai', 'eps']],
    ['application/powerpoint', 'ppt'],
    ['application/pro_eng', ['part', 'prt']],
    ['application/prs.cww', 'cww'],
    ['application/pskc+xml', 'pskcxml'],
    ['application/rdf+xml', 'rdf'],
    ['application/reginfo+xml', 'rif'],
    ['application/relax-ng-compact-syntax', 'rnc'],
    ['application/resource-lists+xml', 'rl'],
    ['application/resource-lists-diff+xml', 'rld'],
    ['application/ringing-tones', 'rng'],
    ['application/rls-services+xml', 'rs'],
    ['application/rsd+xml', 'rsd'],
    ['application/rss+xml', 'xml'],
    ['application/rtf', ['rtf', 'rtx']],
    ['application/sbml+xml', 'sbml'],
    ['application/scvp-cv-request', 'scq'],
    ['application/scvp-cv-response', 'scs'],
    ['application/scvp-vp-request', 'spq'],
    ['application/scvp-vp-response', 'spp'],
    ['application/sdp', 'sdp'],
    ['application/sea', 'sea'],
    ['application/set', 'set'],
    ['application/set-payment-initiation', 'setpay'],
    ['application/set-registration-initiation', 'setreg'],
    ['application/shf+xml', 'shf'],
    ['application/sla', 'stl'],
    ['application/smil', ['smi', 'smil']],
    ['application/smil+xml', 'smi'],
    ['application/solids', 'sol'],
    ['application/sounder', 'sdr'],
    ['application/sparql-query', 'rq'],
    ['application/sparql-results+xml', 'srx'],
    ['application/srgs', 'gram'],
    ['application/srgs+xml', 'grxml'],
    ['application/sru+xml', 'sru'],
    ['application/ssml+xml', 'ssml'],
    ['application/step', ['step', 'stp']],
    ['application/streamingmedia', 'ssm'],
    ['application/tei+xml', 'tei'],
    ['application/thraud+xml', 'tfi'],
    ['application/timestamped-data', 'tsd'],
    ['application/toolbook', 'tbk'],
    ['application/vda', 'vda'],
    ['application/vnd.3gpp.pic-bw-large', 'plb'],
    ['application/vnd.3gpp.pic-bw-small', 'psb'],
    ['application/vnd.3gpp.pic-bw-var', 'pvb'],
    ['application/vnd.3gpp2.tcap', 'tcap'],
    ['application/vnd.3m.post-it-notes', 'pwn'],
    ['application/vnd.accpac.simply.aso', 'aso'],
    ['application/vnd.accpac.simply.imp', 'imp'],
    ['application/vnd.acucobol', 'acu'],
    ['application/vnd.acucorp', 'atc'],
    ['application/vnd.adobe.air-application-installer-package+zip', 'air'],
    ['application/vnd.adobe.fxp', 'fxp'],
    ['application/vnd.adobe.xdp+xml', 'xdp'],
    ['application/vnd.adobe.xfdf', 'xfdf'],
    ['application/vnd.ahead.space', 'ahead'],
    ['application/vnd.airzip.filesecure.azf', 'azf'],
    ['application/vnd.airzip.filesecure.azs', 'azs'],
    ['application/vnd.amazon.ebook', 'azw'],
    ['application/vnd.americandynamics.acc', 'acc'],
    ['application/vnd.amiga.ami', 'ami'],
    ['application/vnd.android.package-archive', 'apk'],
    ['application/vnd.anser-web-certificate-issue-initiation', 'cii'],
    ['application/vnd.anser-web-funds-transfer-initiation', 'fti'],
    ['application/vnd.antix.game-component', 'atx'],
    ['application/vnd.apple.installer+xml', 'mpkg'],
    ['application/vnd.apple.mpegurl', 'm3u8'],
    ['application/vnd.aristanetworks.swi', 'swi'],
    ['application/vnd.audiograph', 'aep'],
    ['application/vnd.blueice.multipass', 'mpm'],
    ['application/vnd.bmi', 'bmi'],
    ['application/vnd.businessobjects', 'rep'],
    ['application/vnd.chemdraw+xml', 'cdxml'],
    ['application/vnd.chipnuts.karaoke-mmd', 'mmd'],
    ['application/vnd.cinderella', 'cdy'],
    ['application/vnd.claymore', 'cla'],
    ['application/vnd.cloanto.rp9', 'rp9'],
    ['application/vnd.clonk.c4group', 'c4g'],
    ['application/vnd.cluetrust.cartomobile-config', 'c11amc'],
    ['application/vnd.cluetrust.cartomobile-config-pkg', 'c11amz'],
    ['application/vnd.commonspace', 'csp'],
    ['application/vnd.contact.cmsg', 'cdbcmsg'],
    ['application/vnd.cosmocaller', 'cmc'],
    ['application/vnd.crick.clicker', 'clkx'],
    ['application/vnd.crick.clicker.keyboard', 'clkk'],
    ['application/vnd.crick.clicker.palette', 'clkp'],
    ['application/vnd.crick.clicker.template', 'clkt'],
    ['application/vnd.crick.clicker.wordbank', 'clkw'],
    ['application/vnd.criticaltools.wbs+xml', 'wbs'],
    ['application/vnd.ctc-posml', 'pml'],
    ['application/vnd.cups-ppd', 'ppd'],
    ['application/vnd.curl.car', 'car'],
    ['application/vnd.curl.pcurl', 'pcurl'],
    ['application/vnd.data-vision.rdz', 'rdz'],
    ['application/vnd.denovo.fcselayout-link', 'fe_launch'],
    ['application/vnd.dna', 'dna'],
    ['application/vnd.dolby.mlp', 'mlp'],
    ['application/vnd.dpgraph', 'dpg'],
    ['application/vnd.dreamfactory', 'dfac'],
    ['application/vnd.dvb.ait', 'ait'],
    ['application/vnd.dvb.service', 'svc'],
    ['application/vnd.dynageo', 'geo'],
    ['application/vnd.ecowin.chart', 'mag'],
    ['application/vnd.enliven', 'nml'],
    ['application/vnd.epson.esf', 'esf'],
    ['application/vnd.epson.msf', 'msf'],
    ['application/vnd.epson.quickanime', 'qam'],
    ['application/vnd.epson.salt', 'slt'],
    ['application/vnd.epson.ssf', 'ssf'],
    ['application/vnd.eszigno3+xml', 'es3'],
    ['application/vnd.ezpix-album', 'ez2'],
    ['application/vnd.ezpix-package', 'ez3'],
    ['application/vnd.fdf', 'fdf'],
    ['application/vnd.fdsn.seed', 'seed'],
    ['application/vnd.flographit', 'gph'],
    ['application/vnd.fluxtime.clip', 'ftc'],
    ['application/vnd.framemaker', 'fm'],
    ['application/vnd.frogans.fnc', 'fnc'],
    ['application/vnd.frogans.ltf', 'ltf'],
    ['application/vnd.fsc.weblaunch', 'fsc'],
    ['application/vnd.fujitsu.oasys', 'oas'],
    ['application/vnd.fujitsu.oasys2', 'oa2'],
    ['application/vnd.fujitsu.oasys3', 'oa3'],
    ['application/vnd.fujitsu.oasysgp', 'fg5'],
    ['application/vnd.fujitsu.oasysprs', 'bh2'],
    ['application/vnd.fujixerox.ddd', 'ddd'],
    ['application/vnd.fujixerox.docuworks', 'xdw'],
    ['application/vnd.fujixerox.docuworks.binder', 'xbd'],
    ['application/vnd.fuzzysheet', 'fzs'],
    ['application/vnd.genomatix.tuxedo', 'txd'],
    ['application/vnd.geogebra.file', 'ggb'],
    ['application/vnd.geogebra.tool', 'ggt'],
    ['application/vnd.geometry-explorer', 'gex'],
    ['application/vnd.geonext', 'gxt'],
    ['application/vnd.geoplan', 'g2w'],
    ['application/vnd.geospace', 'g3w'],
    ['application/vnd.gmx', 'gmx'],
    ['application/vnd.google-earth.kml+xml', 'kml'],
    ['application/vnd.google-earth.kmz', 'kmz'],
    ['application/vnd.grafeq', 'gqf'],
    ['application/vnd.groove-account', 'gac'],
    ['application/vnd.groove-help', 'ghf'],
    ['application/vnd.groove-identity-message', 'gim'],
    ['application/vnd.groove-injector', 'grv'],
    ['application/vnd.groove-tool-message', 'gtm'],
    ['application/vnd.groove-tool-template', 'tpl'],
    ['application/vnd.groove-vcard', 'vcg'],
    ['application/vnd.hal+xml', 'hal'],
    ['application/vnd.handheld-entertainment+xml', 'zmm'],
    ['application/vnd.hbci', 'hbci'],
    ['application/vnd.hhe.lesson-player', 'les'],
    ['application/vnd.hp-hpgl', ['hgl', 'hpg', 'hpgl']],
    ['application/vnd.hp-hpid', 'hpid'],
    ['application/vnd.hp-hps', 'hps'],
    ['application/vnd.hp-jlyt', 'jlt'],
    ['application/vnd.hp-pcl', 'pcl'],
    ['application/vnd.hp-pclxl', 'pclxl'],
    ['application/vnd.hydrostatix.sof-data', 'sfd-hdstx'],
    ['application/vnd.hzn-3d-crossword', 'x3d'],
    ['application/vnd.ibm.minipay', 'mpy'],
    ['application/vnd.ibm.modcap', 'afp'],
    ['application/vnd.ibm.rights-management', 'irm'],
    ['application/vnd.ibm.secure-container', 'sc'],
    ['application/vnd.iccprofile', 'icc'],
    ['application/vnd.igloader', 'igl'],
    ['application/vnd.immervision-ivp', 'ivp'],
    ['application/vnd.immervision-ivu', 'ivu'],
    ['application/vnd.insors.igm', 'igm'],
    ['application/vnd.intercon.formnet', 'xpw'],
    ['application/vnd.intergeo', 'i2g'],
    ['application/vnd.intu.qbo', 'qbo'],
    ['application/vnd.intu.qfx', 'qfx'],
    ['application/vnd.ipunplugged.rcprofile', 'rcprofile'],
    ['application/vnd.irepository.package+xml', 'irp'],
    ['application/vnd.is-xpr', 'xpr'],
    ['application/vnd.isac.fcs', 'fcs'],
    ['application/vnd.jam', 'jam'],
    ['application/vnd.jcp.javame.midlet-rms', 'rms'],
    ['application/vnd.jisp', 'jisp'],
    ['application/vnd.joost.joda-archive', 'joda'],
    ['application/vnd.kahootz', 'ktz'],
    ['application/vnd.kde.karbon', 'karbon'],
    ['application/vnd.kde.kchart', 'chrt'],
    ['application/vnd.kde.kformula', 'kfo'],
    ['application/vnd.kde.kivio', 'flw'],
    ['application/vnd.kde.kontour', 'kon'],
    ['application/vnd.kde.kpresenter', 'kpr'],
    ['application/vnd.kde.kspread', 'ksp'],
    ['application/vnd.kde.kword', 'kwd'],
    ['application/vnd.kenameaapp', 'htke'],
    ['application/vnd.kidspiration', 'kia'],
    ['application/vnd.kinar', 'kne'],
    ['application/vnd.koan', 'skp'],
    ['application/vnd.kodak-descriptor', 'sse'],
    ['application/vnd.las.las+xml', 'lasxml'],
    ['application/vnd.llamagraphics.life-balance.desktop', 'lbd'],
    ['application/vnd.llamagraphics.life-balance.exchange+xml', 'lbe'],
    ['application/vnd.lotus-1-2-3', '123'],
    ['application/vnd.lotus-approach', 'apr'],
    ['application/vnd.lotus-freelance', 'pre'],
    ['application/vnd.lotus-notes', 'nsf'],
    ['application/vnd.lotus-organizer', 'org'],
    ['application/vnd.lotus-screencam', 'scm'],
    ['application/vnd.lotus-wordpro', 'lwp'],
    ['application/vnd.macports.portpkg', 'portpkg'],
    ['application/vnd.mcd', 'mcd'],
    ['application/vnd.medcalcdata', 'mc1'],
    ['application/vnd.mediastation.cdkey', 'cdkey'],
    ['application/vnd.mfer', 'mwf'],
    ['application/vnd.mfmp', 'mfm'],
    ['application/vnd.micrografx.flo', 'flo'],
    ['application/vnd.micrografx.igx', 'igx'],
    ['application/vnd.mif', 'mif'],
    ['application/vnd.mobius.daf', 'daf'],
    ['application/vnd.mobius.dis', 'dis'],
    ['application/vnd.mobius.mbk', 'mbk'],
    ['application/vnd.mobius.mqy', 'mqy'],
    ['application/vnd.mobius.msl', 'msl'],
    ['application/vnd.mobius.plc', 'plc'],
    ['application/vnd.mobius.txf', 'txf'],
    ['application/vnd.mophun.application', 'mpn'],
    ['application/vnd.mophun.certificate', 'mpc'],
    ['application/vnd.mozilla.xul+xml', 'xul'],
    ['application/vnd.ms-artgalry', 'cil'],
    ['application/vnd.ms-cab-compressed', 'cab'],
    ['application/vnd.ms-excel', ['xls', 'xla', 'xlc', 'xlm', 'xlt', 'xlw', 'xlb', 'xll']],
    ['application/vnd.ms-excel.addin.macroenabled.12', 'xlam'],
    ['application/vnd.ms-excel.sheet.binary.macroenabled.12', 'xlsb'],
    ['application/vnd.ms-excel.sheet.macroenabled.12', 'xlsm'],
    ['application/vnd.ms-excel.template.macroenabled.12', 'xltm'],
    ['application/vnd.ms-fontobject', 'eot'],
    ['application/vnd.ms-htmlhelp', 'chm'],
    ['application/vnd.ms-ims', 'ims'],
    ['application/vnd.ms-lrm', 'lrm'],
    ['application/vnd.ms-officetheme', 'thmx'],
    ['application/vnd.ms-outlook', 'msg'],
    ['application/vnd.ms-pki.certstore', 'sst'],
    ['application/vnd.ms-pki.pko', 'pko'],
    ['application/vnd.ms-pki.seccat', 'cat'],
    ['application/vnd.ms-pki.stl', 'stl'],
    ['application/vnd.ms-pkicertstore', 'sst'],
    ['application/vnd.ms-pkiseccat', 'cat'],
    ['application/vnd.ms-pkistl', 'stl'],
    ['application/vnd.ms-powerpoint', ['ppt', 'pot', 'pps', 'ppa', 'pwz']],
    ['application/vnd.ms-powerpoint.addin.macroenabled.12', 'ppam'],
    ['application/vnd.ms-powerpoint.presentation.macroenabled.12', 'pptm'],
    ['application/vnd.ms-powerpoint.slide.macroenabled.12', 'sldm'],
    ['application/vnd.ms-powerpoint.slideshow.macroenabled.12', 'ppsm'],
    ['application/vnd.ms-powerpoint.template.macroenabled.12', 'potm'],
    ['application/vnd.ms-project', 'mpp'],
    ['application/vnd.ms-word.document.macroenabled.12', 'docm'],
    ['application/vnd.ms-word.template.macroenabled.12', 'dotm'],
    ['application/vnd.ms-works', ['wks', 'wcm', 'wdb', 'wps']],
    ['application/vnd.ms-wpl', 'wpl'],
    ['application/vnd.ms-xpsdocument', 'xps'],
    ['application/vnd.mseq', 'mseq'],
    ['application/vnd.musician', 'mus'],
    ['application/vnd.muvee.style', 'msty'],
    ['application/vnd.neurolanguage.nlu', 'nlu'],
    ['application/vnd.noblenet-directory', 'nnd'],
    ['application/vnd.noblenet-sealer', 'nns'],
    ['application/vnd.noblenet-web', 'nnw'],
    ['application/vnd.nokia.configuration-message', 'ncm'],
    ['application/vnd.nokia.n-gage.data', 'ngdat'],
    ['application/vnd.nokia.n-gage.symbian.install', 'n-gage'],
    ['application/vnd.nokia.radio-preset', 'rpst'],
    ['application/vnd.nokia.radio-presets', 'rpss'],
    ['application/vnd.nokia.ringing-tone', 'rng'],
    ['application/vnd.novadigm.edm', 'edm'],
    ['application/vnd.novadigm.edx', 'edx'],
    ['application/vnd.novadigm.ext', 'ext'],
    ['application/vnd.oasis.opendocument.chart', 'odc'],
    ['application/vnd.oasis.opendocument.chart-template', 'otc'],
    ['application/vnd.oasis.opendocument.database', 'odb'],
    ['application/vnd.oasis.opendocument.formula', 'odf'],
    ['application/vnd.oasis.opendocument.formula-template', 'odft'],
    ['application/vnd.oasis.opendocument.graphics', 'odg'],
    ['application/vnd.oasis.opendocument.graphics-template', 'otg'],
    ['application/vnd.oasis.opendocument.image', 'odi'],
    ['application/vnd.oasis.opendocument.image-template', 'oti'],
    ['application/vnd.oasis.opendocument.presentation', 'odp'],
    ['application/vnd.oasis.opendocument.presentation-template', 'otp'],
    ['application/vnd.oasis.opendocument.spreadsheet', 'ods'],
    ['application/vnd.oasis.opendocument.spreadsheet-template', 'ots'],
    ['application/vnd.oasis.opendocument.text', 'odt'],
    ['application/vnd.oasis.opendocument.text-master', 'odm'],
    ['application/vnd.oasis.opendocument.text-template', 'ott'],
    ['application/vnd.oasis.opendocument.text-web', 'oth'],
    ['application/vnd.olpc-sugar', 'xo'],
    ['application/vnd.oma.dd2+xml', 'dd2'],
    ['application/vnd.openofficeorg.extension', 'oxt'],
    ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx'],
    ['application/vnd.openxmlformats-officedocument.presentationml.slide', 'sldx'],
    ['application/vnd.openxmlformats-officedocument.presentationml.slideshow', 'ppsx'],
    ['application/vnd.openxmlformats-officedocument.presentationml.template', 'potx'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.template', 'xltx'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.template', 'dotx'],
    ['application/vnd.osgeo.mapguide.package', 'mgp'],
    ['application/vnd.osgi.dp', 'dp'],
    ['application/vnd.palm', 'pdb'],
    ['application/vnd.pawaafile', 'paw'],
    ['application/vnd.pg.format', 'str'],
    ['application/vnd.pg.osasli', 'ei6'],
    ['application/vnd.picsel', 'efif'],
    ['application/vnd.pmi.widget', 'wg'],
    ['application/vnd.pocketlearn', 'plf'],
    ['application/vnd.powerbuilder6', 'pbd'],
    ['application/vnd.previewsystems.box', 'box'],
    ['application/vnd.proteus.magazine', 'mgz'],
    ['application/vnd.publishare-delta-tree', 'qps'],
    ['application/vnd.pvi.ptid1', 'ptid'],
    ['application/vnd.quark.quarkxpress', 'qxd'],
    ['application/vnd.realvnc.bed', 'bed'],
    ['application/vnd.recordare.musicxml', 'mxl'],
    ['application/vnd.recordare.musicxml+xml', 'musicxml'],
    ['application/vnd.rig.cryptonote', 'cryptonote'],
    ['application/vnd.rim.cod', 'cod'],
    ['application/vnd.rn-realmedia', 'rm'],
    ['application/vnd.rn-realplayer', 'rnx'],
    ['application/vnd.route66.link66+xml', 'link66'],
    ['application/vnd.sailingtracker.track', 'st'],
    ['application/vnd.seemail', 'see'],
    ['application/vnd.sema', 'sema'],
    ['application/vnd.semd', 'semd'],
    ['application/vnd.semf', 'semf'],
    ['application/vnd.shana.informed.formdata', 'ifm'],
    ['application/vnd.shana.informed.formtemplate', 'itp'],
    ['application/vnd.shana.informed.interchange', 'iif'],
    ['application/vnd.shana.informed.package', 'ipk'],
    ['application/vnd.simtech-mindmapper', 'twd'],
    ['application/vnd.smaf', 'mmf'],
    ['application/vnd.smart.teacher', 'teacher'],
    ['application/vnd.solent.sdkm+xml', 'sdkm'],
    ['application/vnd.spotfire.dxp', 'dxp'],
    ['application/vnd.spotfire.sfs', 'sfs'],
    ['application/vnd.stardivision.calc', 'sdc'],
    ['application/vnd.stardivision.draw', 'sda'],
    ['application/vnd.stardivision.impress', 'sdd'],
    ['application/vnd.stardivision.math', 'smf'],
    ['application/vnd.stardivision.writer', 'sdw'],
    ['application/vnd.stardivision.writer-global', 'sgl'],
    ['application/vnd.stepmania.stepchart', 'sm'],
    ['application/vnd.sun.xml.calc', 'sxc'],
    ['application/vnd.sun.xml.calc.template', 'stc'],
    ['application/vnd.sun.xml.draw', 'sxd'],
    ['application/vnd.sun.xml.draw.template', 'std'],
    ['application/vnd.sun.xml.impress', 'sxi'],
    ['application/vnd.sun.xml.impress.template', 'sti'],
    ['application/vnd.sun.xml.math', 'sxm'],
    ['application/vnd.sun.xml.writer', 'sxw'],
    ['application/vnd.sun.xml.writer.global', 'sxg'],
    ['application/vnd.sun.xml.writer.template', 'stw'],
    ['application/vnd.sus-calendar', 'sus'],
    ['application/vnd.svd', 'svd'],
    ['application/vnd.symbian.install', 'sis'],
    ['application/vnd.syncml+xml', 'xsm'],
    ['application/vnd.syncml.dm+wbxml', 'bdm'],
    ['application/vnd.syncml.dm+xml', 'xdm'],
    ['application/vnd.tao.intent-module-archive', 'tao'],
    ['application/vnd.tmobile-livetv', 'tmo'],
    ['application/vnd.trid.tpt', 'tpt'],
    ['application/vnd.triscape.mxs', 'mxs'],
    ['application/vnd.trueapp', 'tra'],
    ['application/vnd.ufdl', 'ufd'],
    ['application/vnd.uiq.theme', 'utz'],
    ['application/vnd.umajin', 'umj'],
    ['application/vnd.unity', 'unityweb'],
    ['application/vnd.uoml+xml', 'uoml'],
    ['application/vnd.vcx', 'vcx'],
    ['application/vnd.visio', 'vsd'],
    ['application/vnd.visionary', 'vis'],
    ['application/vnd.vsf', 'vsf'],
    ['application/vnd.wap.wbxml', 'wbxml'],
    ['application/vnd.wap.wmlc', 'wmlc'],
    ['application/vnd.wap.wmlscriptc', 'wmlsc'],
    ['application/vnd.webturbo', 'wtb'],
    ['application/vnd.wolfram.player', 'nbp'],
    ['application/vnd.wordperfect', 'wpd'],
    ['application/vnd.wqd', 'wqd'],
    ['application/vnd.wt.stf', 'stf'],
    ['application/vnd.xara', ['web', 'xar']],
    ['application/vnd.xfdl', 'xfdl'],
    ['application/vnd.yamaha.hv-dic', 'hvd'],
    ['application/vnd.yamaha.hv-script', 'hvs'],
    ['application/vnd.yamaha.hv-voice', 'hvp'],
    ['application/vnd.yamaha.openscoreformat', 'osf'],
    ['application/vnd.yamaha.openscoreformat.osfpvg+xml', 'osfpvg'],
    ['application/vnd.yamaha.smaf-audio', 'saf'],
    ['application/vnd.yamaha.smaf-phrase', 'spf'],
    ['application/vnd.yellowriver-custom-menu', 'cmp'],
    ['application/vnd.zul', 'zir'],
    ['application/vnd.zzazz.deck+xml', 'zaz'],
    ['application/vocaltec-media-desc', 'vmd'],
    ['application/vocaltec-media-file', 'vmf'],
    ['application/voicexml+xml', 'vxml'],
    ['application/widget', 'wgt'],
    ['application/winhlp', 'hlp'],
    ['application/wordperfect', ['wp', 'wp5', 'wp6', 'wpd']],
    ['application/wordperfect6.0', ['w60', 'wp5']],
    ['application/wordperfect6.1', 'w61'],
    ['application/wsdl+xml', 'wsdl'],
    ['application/wspolicy+xml', 'wspolicy'],
    ['application/x-123', 'wk1'],
    ['application/x-7z-compressed', '7z'],
    ['application/x-abiword', 'abw'],
    ['application/x-ace-compressed', 'ace'],
    ['application/x-aim', 'aim'],
    ['application/x-authorware-bin', 'aab'],
    ['application/x-authorware-map', 'aam'],
    ['application/x-authorware-seg', 'aas'],
    ['application/x-bcpio', 'bcpio'],
    ['application/x-binary', 'bin'],
    ['application/x-binhex40', 'hqx'],
    ['application/x-bittorrent', 'torrent'],
    ['application/x-bsh', ['bsh', 'sh', 'shar']],
    ['application/x-bytecode.elisp', 'elc'],
    ['applicaiton/x-bytecode.python', 'pyc'],
    ['application/x-bzip', 'bz'],
    ['application/x-bzip2', ['boz', 'bz2']],
    ['application/x-cdf', 'cdf'],
    ['application/x-cdlink', 'vcd'],
    ['application/x-chat', ['cha', 'chat']],
    ['application/x-chess-pgn', 'pgn'],
    ['application/x-cmu-raster', 'ras'],
    ['application/x-cocoa', 'cco'],
    ['application/x-compactpro', 'cpt'],
    ['application/x-compress', 'z'],
    ['application/x-compressed', ['tgz', 'gz', 'z', 'zip']],
    ['application/x-conference', 'nsc'],
    ['application/x-cpio', 'cpio'],
    ['application/x-cpt', 'cpt'],
    ['application/x-csh', 'csh'],
    ['application/x-debian-package', 'deb'],
    ['application/x-deepv', 'deepv'],
    ['application/x-director', ['dir', 'dcr', 'dxr']],
    ['application/x-doom', 'wad'],
    ['application/x-dtbncx+xml', 'ncx'],
    ['application/x-dtbook+xml', 'dtb'],
    ['application/x-dtbresource+xml', 'res'],
    ['application/x-dvi', 'dvi'],
    ['application/x-elc', 'elc'],
    ['application/x-envoy', ['env', 'evy']],
    ['application/x-esrehber', 'es'],
    ['application/x-excel', ['xls', 'xla', 'xlb', 'xlc', 'xld', 'xlk', 'xll', 'xlm', 'xlt', 'xlv', 'xlw']],
    ['application/x-font-bdf', 'bdf'],
    ['application/x-font-ghostscript', 'gsf'],
    ['application/x-font-linux-psf', 'psf'],
    ['application/x-font-otf', 'otf'],
    ['application/x-font-pcf', 'pcf'],
    ['application/x-font-snf', 'snf'],
    ['application/x-font-ttf', 'ttf'],
    ['application/x-font-type1', 'pfa'],
    ['application/x-font-woff', 'woff'],
    ['application/x-frame', 'mif'],
    ['application/x-freelance', 'pre'],
    ['application/x-futuresplash', 'spl'],
    ['application/x-gnumeric', 'gnumeric'],
    ['application/x-gsp', 'gsp'],
    ['application/x-gss', 'gss'],
    ['application/x-gtar', 'gtar'],
    ['application/x-gzip', ['gz', 'gzip']],
    ['application/x-hdf', 'hdf'],
    ['application/x-helpfile', ['help', 'hlp']],
    ['application/x-httpd-imap', 'imap'],
    ['application/x-ima', 'ima'],
    ['application/x-internet-signup', ['ins', 'isp']],
    ['application/x-internett-signup', 'ins'],
    ['application/x-inventor', 'iv'],
    ['application/x-ip2', 'ip'],
    ['application/x-iphone', 'iii'],
    ['application/x-java-class', 'class'],
    ['application/x-java-commerce', 'jcm'],
    ['application/x-java-jnlp-file', 'jnlp'],
    ['application/x-javascript', 'js'],
    ['application/x-koan', ['skd', 'skm', 'skp', 'skt']],
    ['application/x-ksh', 'ksh'],
    ['application/x-latex', ['latex', 'ltx']],
    ['application/x-lha', 'lha'],
    ['application/x-lisp', 'lsp'],
    ['application/x-livescreen', 'ivy'],
    ['application/x-lotus', 'wq1'],
    ['application/x-lotusscreencam', 'scm'],
    ['application/x-lzh', 'lzh'],
    ['application/x-lzx', 'lzx'],
    ['application/x-mac-binhex40', 'hqx'],
    ['application/x-macbinary', 'bin'],
    ['application/x-magic-cap-package-1.0', 'mc$'],
    ['application/x-mathcad', 'mcd'],
    ['application/x-meme', 'mm'],
    ['application/x-midi', ['mid', 'midi']],
    ['application/x-mif', 'mif'],
    ['application/x-mix-transfer', 'nix'],
    ['application/x-mobipocket-ebook', 'prc'],
    ['application/x-mplayer2', 'asx'],
    ['application/x-ms-application', 'application'],
    ['application/x-ms-wmd', 'wmd'],
    ['application/x-ms-wmz', 'wmz'],
    ['application/x-ms-xbap', 'xbap'],
    ['application/x-msaccess', 'mdb'],
    ['application/x-msbinder', 'obd'],
    ['application/x-mscardfile', 'crd'],
    ['application/x-msclip', 'clp'],
    ['application/x-msdownload', ['exe', 'dll']],
    ['application/x-msexcel', ['xls', 'xla', 'xlw']],
    ['application/x-msmediaview', ['mvb', 'm13', 'm14']],
    ['application/x-msmetafile', 'wmf'],
    ['application/x-msmoney', 'mny'],
    ['application/x-mspowerpoint', 'ppt'],
    ['application/x-mspublisher', 'pub'],
    ['application/x-msschedule', 'scd'],
    ['application/x-msterminal', 'trm'],
    ['application/x-mswrite', 'wri'],
    ['application/x-navi-animation', 'ani'],
    ['application/x-navidoc', 'nvd'],
    ['application/x-navimap', 'map'],
    ['application/x-navistyle', 'stl'],
    ['application/x-netcdf', ['cdf', 'nc']],
    ['application/x-newton-compatible-pkg', 'pkg'],
    ['application/x-nokia-9000-communicator-add-on-software', 'aos'],
    ['application/x-omc', 'omc'],
    ['application/x-omcdatamaker', 'omcd'],
    ['application/x-omcregerator', 'omcr'],
    ['application/x-pagemaker', ['pm4', 'pm5']],
    ['application/x-pcl', 'pcl'],
    ['application/x-perfmon', ['pma', 'pmc', 'pml', 'pmr', 'pmw']],
    ['application/x-pixclscript', 'plx'],
    ['application/x-pkcs10', 'p10'],
    ['application/x-pkcs12', ['p12', 'pfx']],
    ['application/x-pkcs7-certificates', ['p7b', 'spc']],
    ['application/x-pkcs7-certreqresp', 'p7r'],
    ['application/x-pkcs7-mime', ['p7m', 'p7c']],
    ['application/x-pkcs7-signature', ['p7s', 'p7a']],
    ['application/x-pointplus', 'css'],
    ['application/x-portable-anymap', 'pnm'],
    ['application/x-project', ['mpc', 'mpt', 'mpv', 'mpx']],
    ['application/x-qpro', 'wb1'],
    ['application/x-rar-compressed', 'rar'],
    ['application/x-rtf', 'rtf'],
    ['application/x-sdp', 'sdp'],
    ['application/x-sea', 'sea'],
    ['application/x-seelogo', 'sl'],
    ['application/x-sh', 'sh'],
    ['application/x-shar', ['shar', 'sh']],
    ['application/x-shockwave-flash', 'swf'],
    ['application/x-silverlight-app', 'xap'],
    ['application/x-sit', 'sit'],
    ['application/x-sprite', ['spr', 'sprite']],
    ['application/x-stuffit', 'sit'],
    ['application/x-stuffitx', 'sitx'],
    ['application/x-sv4cpio', 'sv4cpio'],
    ['application/x-sv4crc', 'sv4crc'],
    ['application/x-tar', 'tar'],
    ['application/x-tbook', ['sbk', 'tbk']],
    ['application/x-tcl', 'tcl'],
    ['application/x-tex', 'tex'],
    ['application/x-tex-tfm', 'tfm'],
    ['application/x-texinfo', ['texi', 'texinfo']],
    ['application/x-troff', ['roff', 't', 'tr']],
    ['application/x-troff-man', 'man'],
    ['application/x-troff-me', 'me'],
    ['application/x-troff-ms', 'ms'],
    ['application/x-troff-msvideo', 'avi'],
    ['application/x-ustar', 'ustar'],
    ['application/x-visio', ['vsd', 'vst', 'vsw']],
    ['application/x-vnd.audioexplosion.mzz', 'mzz'],
    ['application/x-vnd.ls-xpix', 'xpix'],
    ['application/x-vrml', 'vrml'],
    ['application/x-wais-source', ['src', 'wsrc']],
    ['application/x-winhelp', 'hlp'],
    ['application/x-wintalk', 'wtk'],
    ['application/x-world', ['wrl', 'svr']],
    ['application/x-wpwin', 'wpd'],
    ['application/x-wri', 'wri'],
    ['application/x-x509-ca-cert', ['cer', 'crt', 'der']],
    ['application/x-x509-user-cert', 'crt'],
    ['application/x-xfig', 'fig'],
    ['application/x-xpinstall', 'xpi'],
    ['application/x-zip-compressed', 'zip'],
    ['application/xcap-diff+xml', 'xdf'],
    ['application/xenc+xml', 'xenc'],
    ['application/xhtml+xml', 'xhtml'],
    ['application/xml', 'xml'],
    ['application/xml-dtd', 'dtd'],
    ['application/xop+xml', 'xop'],
    ['application/xslt+xml', 'xslt'],
    ['application/xspf+xml', 'xspf'],
    ['application/xv+xml', 'mxml'],
    ['application/yang', 'yang'],
    ['application/yin+xml', 'yin'],
    ['application/ynd.ms-pkipko', 'pko'],
    ['application/zip', 'zip'],
    ['audio/adpcm', 'adp'],
    ['audio/aiff', ['aiff', 'aif', 'aifc']],
    ['audio/basic', ['snd', 'au']],
    ['audio/it', 'it'],
    ['audio/make', ['funk', 'my', 'pfunk']],
    ['audio/make.my.funk', 'pfunk'],
    ['audio/mid', ['mid', 'rmi']],
    ['audio/midi', ['midi', 'kar', 'mid']],
    ['audio/mod', 'mod'],
    ['audio/mp4', 'mp4a'],
    ['audio/mpeg', ['mpga', 'mp3', 'm2a', 'mp2', 'mpa', 'mpg']],
    ['audio/mpeg3', 'mp3'],
    ['audio/nspaudio', ['la', 'lma']],
    ['audio/ogg', 'oga'],
    ['audio/s3m', 's3m'],
    ['audio/tsp-audio', 'tsi'],
    ['audio/tsplayer', 'tsp'],
    ['audio/vnd.dece.audio', 'uva'],
    ['audio/vnd.digital-winds', 'eol'],
    ['audio/vnd.dra', 'dra'],
    ['audio/vnd.dts', 'dts'],
    ['audio/vnd.dts.hd', 'dtshd'],
    ['audio/vnd.lucent.voice', 'lvp'],
    ['audio/vnd.ms-playready.media.pya', 'pya'],
    ['audio/vnd.nuera.ecelp4800', 'ecelp4800'],
    ['audio/vnd.nuera.ecelp7470', 'ecelp7470'],
    ['audio/vnd.nuera.ecelp9600', 'ecelp9600'],
    ['audio/vnd.qcelp', 'qcp'],
    ['audio/vnd.rip', 'rip'],
    ['audio/voc', 'voc'],
    ['audio/voxware', 'vox'],
    ['audio/wav', 'wav'],
    ['audio/webm', 'weba'],
    ['audio/x-aac', 'aac'],
    ['audio/x-adpcm', 'snd'],
    ['audio/x-aiff', ['aiff', 'aif', 'aifc']],
    ['audio/x-au', 'au'],
    ['audio/x-gsm', ['gsd', 'gsm']],
    ['audio/x-jam', 'jam'],
    ['audio/x-liveaudio', 'lam'],
    ['audio/x-mid', ['mid', 'midi']],
    ['audio/x-midi', ['midi', 'mid']],
    ['audio/x-mod', 'mod'],
    ['audio/x-mpeg', 'mp2'],
    ['audio/x-mpeg-3', 'mp3'],
    ['audio/x-mpegurl', 'm3u'],
    ['audio/x-mpequrl', 'm3u'],
    ['audio/x-ms-wax', 'wax'],
    ['audio/x-ms-wma', 'wma'],
    ['audio/x-nspaudio', ['la', 'lma']],
    ['audio/x-pn-realaudio', ['ra', 'ram', 'rm', 'rmm', 'rmp']],
    ['audio/x-pn-realaudio-plugin', ['ra', 'rmp', 'rpm']],
    ['audio/x-psid', 'sid'],
    ['audio/x-realaudio', 'ra'],
    ['audio/x-twinvq', 'vqf'],
    ['audio/x-twinvq-plugin', ['vqe', 'vql']],
    ['audio/x-vnd.audioexplosion.mjuicemediafile', 'mjf'],
    ['audio/x-voc', 'voc'],
    ['audio/x-wav', 'wav'],
    ['audio/xm', 'xm'],
    ['chemical/x-cdx', 'cdx'],
    ['chemical/x-cif', 'cif'],
    ['chemical/x-cmdf', 'cmdf'],
    ['chemical/x-cml', 'cml'],
    ['chemical/x-csml', 'csml'],
    ['chemical/x-pdb', ['pdb', 'xyz']],
    ['chemical/x-xyz', 'xyz'],
    ['drawing/x-dwf', 'dwf'],
    ['i-world/i-vrml', 'ivr'],
    ['image/bmp', ['bmp', 'bm']],
    ['image/cgm', 'cgm'],
    ['image/cis-cod', 'cod'],
    ['image/cmu-raster', ['ras', 'rast']],
    ['image/fif', 'fif'],
    ['image/florian', ['flo', 'turbot']],
    ['image/g3fax', 'g3'],
    ['image/gif', 'gif'],
    ['image/ief', ['ief', 'iefs']],
    ['image/jpeg', ['jpeg', 'jpe', 'jpg', 'jfif', 'jfif-tbnl']],
    ['image/jutvision', 'jut'],
    ['image/ktx', 'ktx'],
    ['image/naplps', ['nap', 'naplps']],
    ['image/pict', ['pic', 'pict']],
    ['image/pipeg', 'jfif'],
    ['image/pjpeg', ['jfif', 'jpe', 'jpeg', 'jpg']],
    ['image/png', ['png', 'x-png']],
    ['image/prs.btif', 'btif'],
    ['image/svg+xml', 'svg'],
    ['image/tiff', ['tif', 'tiff']],
    ['image/vasa', 'mcf'],
    ['image/vnd.adobe.photoshop', 'psd'],
    ['image/vnd.dece.graphic', 'uvi'],
    ['image/vnd.djvu', 'djvu'],
    ['image/vnd.dvb.subtitle', 'sub'],
    ['image/vnd.dwg', ['dwg', 'dxf', 'svf']],
    ['image/vnd.dxf', 'dxf'],
    ['image/vnd.fastbidsheet', 'fbs'],
    ['image/vnd.fpx', 'fpx'],
    ['image/vnd.fst', 'fst'],
    ['image/vnd.fujixerox.edmics-mmr', 'mmr'],
    ['image/vnd.fujixerox.edmics-rlc', 'rlc'],
    ['image/vnd.ms-modi', 'mdi'],
    ['image/vnd.net-fpx', ['fpx', 'npx']],
    ['image/vnd.rn-realflash', 'rf'],
    ['image/vnd.rn-realpix', 'rp'],
    ['image/vnd.wap.wbmp', 'wbmp'],
    ['image/vnd.xiff', 'xif'],
    ['image/webp', 'webp'],
    ['image/x-cmu-raster', 'ras'],
    ['image/x-cmx', 'cmx'],
    ['image/x-dwg', ['dwg', 'dxf', 'svf']],
    ['image/x-freehand', 'fh'],
    ['image/x-icon', 'ico'],
    ['image/x-jg', 'art'],
    ['image/x-jps', 'jps'],
    ['image/x-niff', ['niff', 'nif']],
    ['image/x-pcx', 'pcx'],
    ['image/x-pict', ['pct', 'pic']],
    ['image/x-portable-anymap', 'pnm'],
    ['image/x-portable-bitmap', 'pbm'],
    ['image/x-portable-graymap', 'pgm'],
    ['image/x-portable-greymap', 'pgm'],
    ['image/x-portable-pixmap', 'ppm'],
    ['image/x-quicktime', ['qif', 'qti', 'qtif']],
    ['image/x-rgb', 'rgb'],
    ['image/x-tiff', ['tif', 'tiff']],
    ['image/x-windows-bmp', 'bmp'],
    ['image/x-xbitmap', 'xbm'],
    ['image/x-xbm', 'xbm'],
    ['image/x-xpixmap', ['xpm', 'pm']],
    ['image/x-xwd', 'xwd'],
    ['image/x-xwindowdump', 'xwd'],
    ['image/xbm', 'xbm'],
    ['image/xpm', 'xpm'],
    ['message/rfc822', ['eml', 'mht', 'mhtml', 'nws', 'mime']],
    ['model/iges', ['iges', 'igs']],
    ['model/mesh', 'msh'],
    ['model/vnd.collada+xml', 'dae'],
    ['model/vnd.dwf', 'dwf'],
    ['model/vnd.gdl', 'gdl'],
    ['model/vnd.gtw', 'gtw'],
    ['model/vnd.mts', 'mts'],
    ['model/vnd.vtu', 'vtu'],
    ['model/vrml', ['vrml', 'wrl', 'wrz']],
    ['model/x-pov', 'pov'],
    ['multipart/x-gzip', 'gzip'],
    ['multipart/x-ustar', 'ustar'],
    ['multipart/x-zip', 'zip'],
    ['music/crescendo', ['mid', 'midi']],
    ['music/x-karaoke', 'kar'],
    ['paleovu/x-pv', 'pvu'],
    ['text/asp', 'asp'],
    ['text/calendar', 'ics'],
    ['text/css', 'css'],
    ['text/csv', 'csv'],
    ['text/ecmascript', 'js'],
    ['text/h323', '323'],
    ['text/html', ['html', 'htm', 'stm', 'acgi', 'htmls', 'htx', 'shtml']],
    ['text/iuls', 'uls'],
    ['text/javascript', 'js'],
    ['text/mcf', 'mcf'],
    ['text/n3', 'n3'],
    ['text/pascal', 'pas'],
    [
        'text/plain',
        [
            'txt',
            'bas',
            'c',
            'h',
            'c++',
            'cc',
            'com',
            'conf',
            'cxx',
            'def',
            'f',
            'f90',
            'for',
            'g',
            'hh',
            'idc',
            'jav',
            'java',
            'list',
            'log',
            'lst',
            'm',
            'mar',
            'pl',
            'sdml',
            'text'
        ]
    ],
    ['text/plain-bas', 'par'],
    ['text/prs.lines.tag', 'dsc'],
    ['text/richtext', ['rtx', 'rt', 'rtf']],
    ['text/scriplet', 'wsc'],
    ['text/scriptlet', 'sct'],
    ['text/sgml', ['sgm', 'sgml']],
    ['text/tab-separated-values', 'tsv'],
    ['text/troff', 't'],
    ['text/turtle', 'ttl'],
    ['text/uri-list', ['uni', 'unis', 'uri', 'uris']],
    ['text/vnd.abc', 'abc'],
    ['text/vnd.curl', 'curl'],
    ['text/vnd.curl.dcurl', 'dcurl'],
    ['text/vnd.curl.mcurl', 'mcurl'],
    ['text/vnd.curl.scurl', 'scurl'],
    ['text/vnd.fly', 'fly'],
    ['text/vnd.fmi.flexstor', 'flx'],
    ['text/vnd.graphviz', 'gv'],
    ['text/vnd.in3d.3dml', '3dml'],
    ['text/vnd.in3d.spot', 'spot'],
    ['text/vnd.rn-realtext', 'rt'],
    ['text/vnd.sun.j2me.app-descriptor', 'jad'],
    ['text/vnd.wap.wml', 'wml'],
    ['text/vnd.wap.wmlscript', 'wmls'],
    ['text/webviewhtml', 'htt'],
    ['text/x-asm', ['asm', 's']],
    ['text/x-audiosoft-intra', 'aip'],
    ['text/x-c', ['c', 'cc', 'cpp']],
    ['text/x-component', 'htc'],
    ['text/x-fortran', ['for', 'f', 'f77', 'f90']],
    ['text/x-h', ['h', 'hh']],
    ['text/x-java-source', ['java', 'jav']],
    ['text/x-java-source,java', 'java'],
    ['text/x-la-asf', 'lsx'],
    ['text/x-m', 'm'],
    ['text/x-pascal', 'p'],
    ['text/x-script', 'hlb'],
    ['text/x-script.csh', 'csh'],
    ['text/x-script.elisp', 'el'],
    ['text/x-script.guile', 'scm'],
    ['text/x-script.ksh', 'ksh'],
    ['text/x-script.lisp', 'lsp'],
    ['text/x-script.perl', 'pl'],
    ['text/x-script.perl-module', 'pm'],
    ['text/x-script.phyton', 'py'],
    ['text/x-script.rexx', 'rexx'],
    ['text/x-script.scheme', 'scm'],
    ['text/x-script.sh', 'sh'],
    ['text/x-script.tcl', 'tcl'],
    ['text/x-script.tcsh', 'tcsh'],
    ['text/x-script.zsh', 'zsh'],
    ['text/x-server-parsed-html', ['shtml', 'ssi']],
    ['text/x-setext', 'etx'],
    ['text/x-sgml', ['sgm', 'sgml']],
    ['text/x-speech', ['spc', 'talk']],
    ['text/x-uil', 'uil'],
    ['text/x-uuencode', ['uu', 'uue']],
    ['text/x-vcalendar', 'vcs'],
    ['text/x-vcard', 'vcf'],
    ['text/xml', 'xml'],
    ['video/3gpp', '3gp'],
    ['video/3gpp2', '3g2'],
    ['video/animaflex', 'afl'],
    ['video/avi', 'avi'],
    ['video/avs-video', 'avs'],
    ['video/dl', 'dl'],
    ['video/fli', 'fli'],
    ['video/gl', 'gl'],
    ['video/h261', 'h261'],
    ['video/h263', 'h263'],
    ['video/h264', 'h264'],
    ['video/jpeg', 'jpgv'],
    ['video/jpm', 'jpm'],
    ['video/mj2', 'mj2'],
    ['video/mp4', 'mp4'],
    ['video/mpeg', ['mpeg', 'mp2', 'mpa', 'mpe', 'mpg', 'mpv2', 'm1v', 'm2v', 'mp3']],
    ['video/msvideo', 'avi'],
    ['video/ogg', 'ogv'],
    ['video/quicktime', ['mov', 'qt', 'moov']],
    ['video/vdo', 'vdo'],
    ['video/vivo', ['viv', 'vivo']],
    ['video/vnd.dece.hd', 'uvh'],
    ['video/vnd.dece.mobile', 'uvm'],
    ['video/vnd.dece.pd', 'uvp'],
    ['video/vnd.dece.sd', 'uvs'],
    ['video/vnd.dece.video', 'uvv'],
    ['video/vnd.fvt', 'fvt'],
    ['video/vnd.mpegurl', 'mxu'],
    ['video/vnd.ms-playready.media.pyv', 'pyv'],
    ['video/vnd.rn-realvideo', 'rv'],
    ['video/vnd.uvvu.mp4', 'uvu'],
    ['video/vnd.vivo', ['viv', 'vivo']],
    ['video/vosaic', 'vos'],
    ['video/webm', 'webm'],
    ['video/x-amt-demorun', 'xdr'],
    ['video/x-amt-showrun', 'xsr'],
    ['video/x-atomic3d-feature', 'fmf'],
    ['video/x-dl', 'dl'],
    ['video/x-dv', ['dif', 'dv']],
    ['video/x-f4v', 'f4v'],
    ['video/x-fli', 'fli'],
    ['video/x-flv', 'flv'],
    ['video/x-gl', 'gl'],
    ['video/x-isvideo', 'isu'],
    ['video/x-la-asf', ['lsf', 'lsx']],
    ['video/x-m4v', 'm4v'],
    ['video/x-motion-jpeg', 'mjpg'],
    ['video/x-mpeg', ['mp3', 'mp2']],
    ['video/x-mpeq2a', 'mp2'],
    ['video/x-ms-asf', ['asf', 'asr', 'asx']],
    ['video/x-ms-asf-plugin', 'asx'],
    ['video/x-ms-wm', 'wm'],
    ['video/x-ms-wmv', 'wmv'],
    ['video/x-ms-wmx', 'wmx'],
    ['video/x-ms-wvx', 'wvx'],
    ['video/x-msvideo', 'avi'],
    ['video/x-qtc', 'qtc'],
    ['video/x-scm', 'scm'],
    ['video/x-sgi-movie', ['movie', 'mv']],
    ['windows/metafile', 'wmf'],
    ['www/mime', 'mime'],
    ['x-conference/x-cooltalk', 'ice'],
    ['x-music/x-midi', ['mid', 'midi']],
    ['x-world/x-3dmf', ['3dm', '3dmf', 'qd3', 'qd3d']],
    ['x-world/x-svr', 'svr'],
    ['x-world/x-vrml', ['flr', 'vrml', 'wrl', 'wrz', 'xaf', 'xof']],
    ['x-world/x-vrt', 'vrt'],
    ['xgl/drawing', 'xgz'],
    ['xgl/movie', 'xmz']
]);
const extensions = new Map([
    ['123', 'application/vnd.lotus-1-2-3'],
    ['323', 'text/h323'],
    ['*', 'application/octet-stream'],
    ['3dm', 'x-world/x-3dmf'],
    ['3dmf', 'x-world/x-3dmf'],
    ['3dml', 'text/vnd.in3d.3dml'],
    ['3g2', 'video/3gpp2'],
    ['3gp', 'video/3gpp'],
    ['7z', 'application/x-7z-compressed'],
    ['a', 'application/octet-stream'],
    ['aab', 'application/x-authorware-bin'],
    ['aac', 'audio/x-aac'],
    ['aam', 'application/x-authorware-map'],
    ['aas', 'application/x-authorware-seg'],
    ['abc', 'text/vnd.abc'],
    ['abw', 'application/x-abiword'],
    ['ac', 'application/pkix-attr-cert'],
    ['acc', 'application/vnd.americandynamics.acc'],
    ['ace', 'application/x-ace-compressed'],
    ['acgi', 'text/html'],
    ['acu', 'application/vnd.acucobol'],
    ['acx', 'application/internet-property-stream'],
    ['adp', 'audio/adpcm'],
    ['aep', 'application/vnd.audiograph'],
    ['afl', 'video/animaflex'],
    ['afp', 'application/vnd.ibm.modcap'],
    ['ahead', 'application/vnd.ahead.space'],
    ['ai', 'application/postscript'],
    ['aif', ['audio/aiff', 'audio/x-aiff']],
    ['aifc', ['audio/aiff', 'audio/x-aiff']],
    ['aiff', ['audio/aiff', 'audio/x-aiff']],
    ['aim', 'application/x-aim'],
    ['aip', 'text/x-audiosoft-intra'],
    ['air', 'application/vnd.adobe.air-application-installer-package+zip'],
    ['ait', 'application/vnd.dvb.ait'],
    ['ami', 'application/vnd.amiga.ami'],
    ['ani', 'application/x-navi-animation'],
    ['aos', 'application/x-nokia-9000-communicator-add-on-software'],
    ['apk', 'application/vnd.android.package-archive'],
    ['application', 'application/x-ms-application'],
    ['apr', 'application/vnd.lotus-approach'],
    ['aps', 'application/mime'],
    ['arc', 'application/octet-stream'],
    ['arj', ['application/arj', 'application/octet-stream']],
    ['art', 'image/x-jg'],
    ['asf', 'video/x-ms-asf'],
    ['asm', 'text/x-asm'],
    ['aso', 'application/vnd.accpac.simply.aso'],
    ['asp', 'text/asp'],
    ['asr', 'video/x-ms-asf'],
    ['asx', ['video/x-ms-asf', 'application/x-mplayer2', 'video/x-ms-asf-plugin']],
    ['atc', 'application/vnd.acucorp'],
    ['atomcat', 'application/atomcat+xml'],
    ['atomsvc', 'application/atomsvc+xml'],
    ['atx', 'application/vnd.antix.game-component'],
    ['au', ['audio/basic', 'audio/x-au']],
    ['avi', ['video/avi', 'video/msvideo', 'application/x-troff-msvideo', 'video/x-msvideo']],
    ['avs', 'video/avs-video'],
    ['aw', 'application/applixware'],
    ['axs', 'application/olescript'],
    ['azf', 'application/vnd.airzip.filesecure.azf'],
    ['azs', 'application/vnd.airzip.filesecure.azs'],
    ['azw', 'application/vnd.amazon.ebook'],
    ['bas', 'text/plain'],
    ['bcpio', 'application/x-bcpio'],
    ['bdf', 'application/x-font-bdf'],
    ['bdm', 'application/vnd.syncml.dm+wbxml'],
    ['bed', 'application/vnd.realvnc.bed'],
    ['bh2', 'application/vnd.fujitsu.oasysprs'],
    ['bin', ['application/octet-stream', 'application/mac-binary', 'application/macbinary', 'application/x-macbinary', 'application/x-binary']],
    ['bm', 'image/bmp'],
    ['bmi', 'application/vnd.bmi'],
    ['bmp', ['image/bmp', 'image/x-windows-bmp']],
    ['boo', 'application/book'],
    ['book', 'application/book'],
    ['box', 'application/vnd.previewsystems.box'],
    ['boz', 'application/x-bzip2'],
    ['bsh', 'application/x-bsh'],
    ['btif', 'image/prs.btif'],
    ['bz', 'application/x-bzip'],
    ['bz2', 'application/x-bzip2'],
    ['c', ['text/plain', 'text/x-c']],
    ['c++', 'text/plain'],
    ['c11amc', 'application/vnd.cluetrust.cartomobile-config'],
    ['c11amz', 'application/vnd.cluetrust.cartomobile-config-pkg'],
    ['c4g', 'application/vnd.clonk.c4group'],
    ['cab', 'application/vnd.ms-cab-compressed'],
    ['car', 'application/vnd.curl.car'],
    ['cat', ['application/vnd.ms-pkiseccat', 'application/vnd.ms-pki.seccat']],
    ['cc', ['text/plain', 'text/x-c']],
    ['ccad', 'application/clariscad'],
    ['cco', 'application/x-cocoa'],
    ['ccxml', 'application/ccxml+xml,'],
    ['cdbcmsg', 'application/vnd.contact.cmsg'],
    ['cdf', ['application/cdf', 'application/x-cdf', 'application/x-netcdf']],
    ['cdkey', 'application/vnd.mediastation.cdkey'],
    ['cdmia', 'application/cdmi-capability'],
    ['cdmic', 'application/cdmi-container'],
    ['cdmid', 'application/cdmi-domain'],
    ['cdmio', 'application/cdmi-object'],
    ['cdmiq', 'application/cdmi-queue'],
    ['cdx', 'chemical/x-cdx'],
    ['cdxml', 'application/vnd.chemdraw+xml'],
    ['cdy', 'application/vnd.cinderella'],
    ['cer', ['application/pkix-cert', 'application/x-x509-ca-cert']],
    ['cgm', 'image/cgm'],
    ['cha', 'application/x-chat'],
    ['chat', 'application/x-chat'],
    ['chm', 'application/vnd.ms-htmlhelp'],
    ['chrt', 'application/vnd.kde.kchart'],
    ['cif', 'chemical/x-cif'],
    ['cii', 'application/vnd.anser-web-certificate-issue-initiation'],
    ['cil', 'application/vnd.ms-artgalry'],
    ['cla', 'application/vnd.claymore'],
    ['class', ['application/octet-stream', 'application/java', 'application/java-byte-code', 'application/java-vm', 'application/x-java-class']],
    ['clkk', 'application/vnd.crick.clicker.keyboard'],
    ['clkp', 'application/vnd.crick.clicker.palette'],
    ['clkt', 'application/vnd.crick.clicker.template'],
    ['clkw', 'application/vnd.crick.clicker.wordbank'],
    ['clkx', 'application/vnd.crick.clicker'],
    ['clp', 'application/x-msclip'],
    ['cmc', 'application/vnd.cosmocaller'],
    ['cmdf', 'chemical/x-cmdf'],
    ['cml', 'chemical/x-cml'],
    ['cmp', 'application/vnd.yellowriver-custom-menu'],
    ['cmx', 'image/x-cmx'],
    ['cod', ['image/cis-cod', 'application/vnd.rim.cod']],
    ['com', ['application/octet-stream', 'text/plain']],
    ['conf', 'text/plain'],
    ['cpio', 'application/x-cpio'],
    ['cpp', 'text/x-c'],
    ['cpt', ['application/mac-compactpro', 'application/x-compactpro', 'application/x-cpt']],
    ['crd', 'application/x-mscardfile'],
    ['crl', ['application/pkix-crl', 'application/pkcs-crl']],
    ['crt', ['application/pkix-cert', 'application/x-x509-user-cert', 'application/x-x509-ca-cert']],
    ['cryptonote', 'application/vnd.rig.cryptonote'],
    ['csh', ['text/x-script.csh', 'application/x-csh']],
    ['csml', 'chemical/x-csml'],
    ['csp', 'application/vnd.commonspace'],
    ['css', ['text/css', 'application/x-pointplus']],
    ['csv', 'text/csv'],
    ['cu', 'application/cu-seeme'],
    ['curl', 'text/vnd.curl'],
    ['cww', 'application/prs.cww'],
    ['cxx', 'text/plain'],
    ['dae', 'model/vnd.collada+xml'],
    ['daf', 'application/vnd.mobius.daf'],
    ['davmount', 'application/davmount+xml'],
    ['dcr', 'application/x-director'],
    ['dcurl', 'text/vnd.curl.dcurl'],
    ['dd2', 'application/vnd.oma.dd2+xml'],
    ['ddd', 'application/vnd.fujixerox.ddd'],
    ['deb', 'application/x-debian-package'],
    ['deepv', 'application/x-deepv'],
    ['def', 'text/plain'],
    ['der', 'application/x-x509-ca-cert'],
    ['dfac', 'application/vnd.dreamfactory'],
    ['dif', 'video/x-dv'],
    ['dir', 'application/x-director'],
    ['dis', 'application/vnd.mobius.dis'],
    ['djvu', 'image/vnd.djvu'],
    ['dl', ['video/dl', 'video/x-dl']],
    ['dll', 'application/x-msdownload'],
    ['dms', 'application/octet-stream'],
    ['dna', 'application/vnd.dna'],
    ['doc', 'application/msword'],
    ['docm', 'application/vnd.ms-word.document.macroenabled.12'],
    ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['dot', 'application/msword'],
    ['dotm', 'application/vnd.ms-word.template.macroenabled.12'],
    ['dotx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.template'],
    ['dp', ['application/commonground', 'application/vnd.osgi.dp']],
    ['dpg', 'application/vnd.dpgraph'],
    ['dra', 'audio/vnd.dra'],
    ['drw', 'application/drafting'],
    ['dsc', 'text/prs.lines.tag'],
    ['dssc', 'application/dssc+der'],
    ['dtb', 'application/x-dtbook+xml'],
    ['dtd', 'application/xml-dtd'],
    ['dts', 'audio/vnd.dts'],
    ['dtshd', 'audio/vnd.dts.hd'],
    ['dump', 'application/octet-stream'],
    ['dv', 'video/x-dv'],
    ['dvi', 'application/x-dvi'],
    ['dwf', ['model/vnd.dwf', 'drawing/x-dwf']],
    ['dwg', ['application/acad', 'image/vnd.dwg', 'image/x-dwg']],
    ['dxf', ['application/dxf', 'image/vnd.dwg', 'image/vnd.dxf', 'image/x-dwg']],
    ['dxp', 'application/vnd.spotfire.dxp'],
    ['dxr', 'application/x-director'],
    ['ecelp4800', 'audio/vnd.nuera.ecelp4800'],
    ['ecelp7470', 'audio/vnd.nuera.ecelp7470'],
    ['ecelp9600', 'audio/vnd.nuera.ecelp9600'],
    ['edm', 'application/vnd.novadigm.edm'],
    ['edx', 'application/vnd.novadigm.edx'],
    ['efif', 'application/vnd.picsel'],
    ['ei6', 'application/vnd.pg.osasli'],
    ['el', 'text/x-script.elisp'],
    ['elc', ['application/x-elc', 'application/x-bytecode.elisp']],
    ['eml', 'message/rfc822'],
    ['emma', 'application/emma+xml'],
    ['env', 'application/x-envoy'],
    ['eol', 'audio/vnd.digital-winds'],
    ['eot', 'application/vnd.ms-fontobject'],
    ['eps', 'application/postscript'],
    ['epub', 'application/epub+zip'],
    ['es', ['application/ecmascript', 'application/x-esrehber']],
    ['es3', 'application/vnd.eszigno3+xml'],
    ['esf', 'application/vnd.epson.esf'],
    ['etx', 'text/x-setext'],
    ['evy', ['application/envoy', 'application/x-envoy']],
    ['exe', ['application/octet-stream', 'application/x-msdownload']],
    ['exi', 'application/exi'],
    ['ext', 'application/vnd.novadigm.ext'],
    ['ez2', 'application/vnd.ezpix-album'],
    ['ez3', 'application/vnd.ezpix-package'],
    ['f', ['text/plain', 'text/x-fortran']],
    ['f4v', 'video/x-f4v'],
    ['f77', 'text/x-fortran'],
    ['f90', ['text/plain', 'text/x-fortran']],
    ['fbs', 'image/vnd.fastbidsheet'],
    ['fcs', 'application/vnd.isac.fcs'],
    ['fdf', 'application/vnd.fdf'],
    ['fe_launch', 'application/vnd.denovo.fcselayout-link'],
    ['fg5', 'application/vnd.fujitsu.oasysgp'],
    ['fh', 'image/x-freehand'],
    ['fif', ['application/fractals', 'image/fif']],
    ['fig', 'application/x-xfig'],
    ['fli', ['video/fli', 'video/x-fli']],
    ['flo', ['image/florian', 'application/vnd.micrografx.flo']],
    ['flr', 'x-world/x-vrml'],
    ['flv', 'video/x-flv'],
    ['flw', 'application/vnd.kde.kivio'],
    ['flx', 'text/vnd.fmi.flexstor'],
    ['fly', 'text/vnd.fly'],
    ['fm', 'application/vnd.framemaker'],
    ['fmf', 'video/x-atomic3d-feature'],
    ['fnc', 'application/vnd.frogans.fnc'],
    ['for', ['text/plain', 'text/x-fortran']],
    ['fpx', ['image/vnd.fpx', 'image/vnd.net-fpx']],
    ['frl', 'application/freeloader'],
    ['fsc', 'application/vnd.fsc.weblaunch'],
    ['fst', 'image/vnd.fst'],
    ['ftc', 'application/vnd.fluxtime.clip'],
    ['fti', 'application/vnd.anser-web-funds-transfer-initiation'],
    ['funk', 'audio/make'],
    ['fvt', 'video/vnd.fvt'],
    ['fxp', 'application/vnd.adobe.fxp'],
    ['fzs', 'application/vnd.fuzzysheet'],
    ['g', 'text/plain'],
    ['g2w', 'application/vnd.geoplan'],
    ['g3', 'image/g3fax'],
    ['g3w', 'application/vnd.geospace'],
    ['gac', 'application/vnd.groove-account'],
    ['gdl', 'model/vnd.gdl'],
    ['geo', 'application/vnd.dynageo'],
    ['gex', 'application/vnd.geometry-explorer'],
    ['ggb', 'application/vnd.geogebra.file'],
    ['ggt', 'application/vnd.geogebra.tool'],
    ['ghf', 'application/vnd.groove-help'],
    ['gif', 'image/gif'],
    ['gim', 'application/vnd.groove-identity-message'],
    ['gl', ['video/gl', 'video/x-gl']],
    ['gmx', 'application/vnd.gmx'],
    ['gnumeric', 'application/x-gnumeric'],
    ['gph', 'application/vnd.flographit'],
    ['gqf', 'application/vnd.grafeq'],
    ['gram', 'application/srgs'],
    ['grv', 'application/vnd.groove-injector'],
    ['grxml', 'application/srgs+xml'],
    ['gsd', 'audio/x-gsm'],
    ['gsf', 'application/x-font-ghostscript'],
    ['gsm', 'audio/x-gsm'],
    ['gsp', 'application/x-gsp'],
    ['gss', 'application/x-gss'],
    ['gtar', 'application/x-gtar'],
    ['gtm', 'application/vnd.groove-tool-message'],
    ['gtw', 'model/vnd.gtw'],
    ['gv', 'text/vnd.graphviz'],
    ['gxt', 'application/vnd.geonext'],
    ['gz', ['application/x-gzip', 'application/x-compressed']],
    ['gzip', ['multipart/x-gzip', 'application/x-gzip']],
    ['h', ['text/plain', 'text/x-h']],
    ['h261', 'video/h261'],
    ['h263', 'video/h263'],
    ['h264', 'video/h264'],
    ['hal', 'application/vnd.hal+xml'],
    ['hbci', 'application/vnd.hbci'],
    ['hdf', 'application/x-hdf'],
    ['help', 'application/x-helpfile'],
    ['hgl', 'application/vnd.hp-hpgl'],
    ['hh', ['text/plain', 'text/x-h']],
    ['hlb', 'text/x-script'],
    ['hlp', ['application/winhlp', 'application/hlp', 'application/x-helpfile', 'application/x-winhelp']],
    ['hpg', 'application/vnd.hp-hpgl'],
    ['hpgl', 'application/vnd.hp-hpgl'],
    ['hpid', 'application/vnd.hp-hpid'],
    ['hps', 'application/vnd.hp-hps'],
    [
        'hqx',
        [
            'application/mac-binhex40',
            'application/binhex',
            'application/binhex4',
            'application/mac-binhex',
            'application/x-binhex40',
            'application/x-mac-binhex40'
        ]
    ],
    ['hta', 'application/hta'],
    ['htc', 'text/x-component'],
    ['htke', 'application/vnd.kenameaapp'],
    ['htm', 'text/html'],
    ['html', 'text/html'],
    ['htmls', 'text/html'],
    ['htt', 'text/webviewhtml'],
    ['htx', 'text/html'],
    ['hvd', 'application/vnd.yamaha.hv-dic'],
    ['hvp', 'application/vnd.yamaha.hv-voice'],
    ['hvs', 'application/vnd.yamaha.hv-script'],
    ['i2g', 'application/vnd.intergeo'],
    ['icc', 'application/vnd.iccprofile'],
    ['ice', 'x-conference/x-cooltalk'],
    ['ico', 'image/x-icon'],
    ['ics', 'text/calendar'],
    ['idc', 'text/plain'],
    ['ief', 'image/ief'],
    ['iefs', 'image/ief'],
    ['ifm', 'application/vnd.shana.informed.formdata'],
    ['iges', ['application/iges', 'model/iges']],
    ['igl', 'application/vnd.igloader'],
    ['igm', 'application/vnd.insors.igm'],
    ['igs', ['application/iges', 'model/iges']],
    ['igx', 'application/vnd.micrografx.igx'],
    ['iif', 'application/vnd.shana.informed.interchange'],
    ['iii', 'application/x-iphone'],
    ['ima', 'application/x-ima'],
    ['imap', 'application/x-httpd-imap'],
    ['imp', 'application/vnd.accpac.simply.imp'],
    ['ims', 'application/vnd.ms-ims'],
    ['inf', 'application/inf'],
    ['ins', ['application/x-internet-signup', 'application/x-internett-signup']],
    ['ip', 'application/x-ip2'],
    ['ipfix', 'application/ipfix'],
    ['ipk', 'application/vnd.shana.informed.package'],
    ['irm', 'application/vnd.ibm.rights-management'],
    ['irp', 'application/vnd.irepository.package+xml'],
    ['isp', 'application/x-internet-signup'],
    ['isu', 'video/x-isvideo'],
    ['it', 'audio/it'],
    ['itp', 'application/vnd.shana.informed.formtemplate'],
    ['iv', 'application/x-inventor'],
    ['ivp', 'application/vnd.immervision-ivp'],
    ['ivr', 'i-world/i-vrml'],
    ['ivu', 'application/vnd.immervision-ivu'],
    ['ivy', 'application/x-livescreen'],
    ['jad', 'text/vnd.sun.j2me.app-descriptor'],
    ['jam', ['application/vnd.jam', 'audio/x-jam']],
    ['jar', 'application/java-archive'],
    ['jav', ['text/plain', 'text/x-java-source']],
    ['java', ['text/plain', 'text/x-java-source,java', 'text/x-java-source']],
    ['jcm', 'application/x-java-commerce'],
    ['jfif', ['image/pipeg', 'image/jpeg', 'image/pjpeg']],
    ['jfif-tbnl', 'image/jpeg'],
    ['jisp', 'application/vnd.jisp'],
    ['jlt', 'application/vnd.hp-jlyt'],
    ['jnlp', 'application/x-java-jnlp-file'],
    ['joda', 'application/vnd.joost.joda-archive'],
    ['jpe', ['image/jpeg', 'image/pjpeg']],
    ['jpeg', ['image/jpeg', 'image/pjpeg']],
    ['jpg', ['image/jpeg', 'image/pjpeg']],
    ['jpgv', 'video/jpeg'],
    ['jpm', 'video/jpm'],
    ['jps', 'image/x-jps'],
    ['js', ['application/javascript', 'application/ecmascript', 'text/javascript', 'text/ecmascript', 'application/x-javascript']],
    ['json', 'application/json'],
    ['jut', 'image/jutvision'],
    ['kar', ['audio/midi', 'music/x-karaoke']],
    ['karbon', 'application/vnd.kde.karbon'],
    ['kfo', 'application/vnd.kde.kformula'],
    ['kia', 'application/vnd.kidspiration'],
    ['kml', 'application/vnd.google-earth.kml+xml'],
    ['kmz', 'application/vnd.google-earth.kmz'],
    ['kne', 'application/vnd.kinar'],
    ['kon', 'application/vnd.kde.kontour'],
    ['kpr', 'application/vnd.kde.kpresenter'],
    ['ksh', ['application/x-ksh', 'text/x-script.ksh']],
    ['ksp', 'application/vnd.kde.kspread'],
    ['ktx', 'image/ktx'],
    ['ktz', 'application/vnd.kahootz'],
    ['kwd', 'application/vnd.kde.kword'],
    ['la', ['audio/nspaudio', 'audio/x-nspaudio']],
    ['lam', 'audio/x-liveaudio'],
    ['lasxml', 'application/vnd.las.las+xml'],
    ['latex', 'application/x-latex'],
    ['lbd', 'application/vnd.llamagraphics.life-balance.desktop'],
    ['lbe', 'application/vnd.llamagraphics.life-balance.exchange+xml'],
    ['les', 'application/vnd.hhe.lesson-player'],
    ['lha', ['application/octet-stream', 'application/lha', 'application/x-lha']],
    ['lhx', 'application/octet-stream'],
    ['link66', 'application/vnd.route66.link66+xml'],
    ['list', 'text/plain'],
    ['lma', ['audio/nspaudio', 'audio/x-nspaudio']],
    ['log', 'text/plain'],
    ['lrm', 'application/vnd.ms-lrm'],
    ['lsf', 'video/x-la-asf'],
    ['lsp', ['application/x-lisp', 'text/x-script.lisp']],
    ['lst', 'text/plain'],
    ['lsx', ['video/x-la-asf', 'text/x-la-asf']],
    ['ltf', 'application/vnd.frogans.ltf'],
    ['ltx', 'application/x-latex'],
    ['lvp', 'audio/vnd.lucent.voice'],
    ['lwp', 'application/vnd.lotus-wordpro'],
    ['lzh', ['application/octet-stream', 'application/x-lzh']],
    ['lzx', ['application/lzx', 'application/octet-stream', 'application/x-lzx']],
    ['m', ['text/plain', 'text/x-m']],
    ['m13', 'application/x-msmediaview'],
    ['m14', 'application/x-msmediaview'],
    ['m1v', 'video/mpeg'],
    ['m21', 'application/mp21'],
    ['m2a', 'audio/mpeg'],
    ['m2v', 'video/mpeg'],
    ['m3u', ['audio/x-mpegurl', 'audio/x-mpequrl']],
    ['m3u8', 'application/vnd.apple.mpegurl'],
    ['m4v', 'video/x-m4v'],
    ['ma', 'application/mathematica'],
    ['mads', 'application/mads+xml'],
    ['mag', 'application/vnd.ecowin.chart'],
    ['man', 'application/x-troff-man'],
    ['map', 'application/x-navimap'],
    ['mar', 'text/plain'],
    ['mathml', 'application/mathml+xml'],
    ['mbd', 'application/mbedlet'],
    ['mbk', 'application/vnd.mobius.mbk'],
    ['mbox', 'application/mbox'],
    ['mc$', 'application/x-magic-cap-package-1.0'],
    ['mc1', 'application/vnd.medcalcdata'],
    ['mcd', ['application/mcad', 'application/vnd.mcd', 'application/x-mathcad']],
    ['mcf', ['image/vasa', 'text/mcf']],
    ['mcp', 'application/netmc'],
    ['mcurl', 'text/vnd.curl.mcurl'],
    ['mdb', 'application/x-msaccess'],
    ['mdi', 'image/vnd.ms-modi'],
    ['me', 'application/x-troff-me'],
    ['meta4', 'application/metalink4+xml'],
    ['mets', 'application/mets+xml'],
    ['mfm', 'application/vnd.mfmp'],
    ['mgp', 'application/vnd.osgeo.mapguide.package'],
    ['mgz', 'application/vnd.proteus.magazine'],
    ['mht', 'message/rfc822'],
    ['mhtml', 'message/rfc822'],
    ['mid', ['audio/mid', 'audio/midi', 'music/crescendo', 'x-music/x-midi', 'audio/x-midi', 'application/x-midi', 'audio/x-mid']],
    ['midi', ['audio/midi', 'music/crescendo', 'x-music/x-midi', 'audio/x-midi', 'application/x-midi', 'audio/x-mid']],
    ['mif', ['application/vnd.mif', 'application/x-mif', 'application/x-frame']],
    ['mime', ['message/rfc822', 'www/mime']],
    ['mj2', 'video/mj2'],
    ['mjf', 'audio/x-vnd.audioexplosion.mjuicemediafile'],
    ['mjpg', 'video/x-motion-jpeg'],
    ['mlp', 'application/vnd.dolby.mlp'],
    ['mm', ['application/base64', 'application/x-meme']],
    ['mmd', 'application/vnd.chipnuts.karaoke-mmd'],
    ['mme', 'application/base64'],
    ['mmf', 'application/vnd.smaf'],
    ['mmr', 'image/vnd.fujixerox.edmics-mmr'],
    ['mny', 'application/x-msmoney'],
    ['mod', ['audio/mod', 'audio/x-mod']],
    ['mods', 'application/mods+xml'],
    ['moov', 'video/quicktime'],
    ['mov', 'video/quicktime'],
    ['movie', 'video/x-sgi-movie'],
    ['mp2', ['video/mpeg', 'audio/mpeg', 'video/x-mpeg', 'audio/x-mpeg', 'video/x-mpeq2a']],
    ['mp3', ['audio/mpeg', 'audio/mpeg3', 'video/mpeg', 'audio/x-mpeg-3', 'video/x-mpeg']],
    ['mp4', ['video/mp4', 'application/mp4']],
    ['mp4a', 'audio/mp4'],
    ['mpa', ['video/mpeg', 'audio/mpeg']],
    ['mpc', ['application/vnd.mophun.certificate', 'application/x-project']],
    ['mpe', 'video/mpeg'],
    ['mpeg', 'video/mpeg'],
    ['mpg', ['video/mpeg', 'audio/mpeg']],
    ['mpga', 'audio/mpeg'],
    ['mpkg', 'application/vnd.apple.installer+xml'],
    ['mpm', 'application/vnd.blueice.multipass'],
    ['mpn', 'application/vnd.mophun.application'],
    ['mpp', 'application/vnd.ms-project'],
    ['mpt', 'application/x-project'],
    ['mpv', 'application/x-project'],
    ['mpv2', 'video/mpeg'],
    ['mpx', 'application/x-project'],
    ['mpy', 'application/vnd.ibm.minipay'],
    ['mqy', 'application/vnd.mobius.mqy'],
    ['mrc', 'application/marc'],
    ['mrcx', 'application/marcxml+xml'],
    ['ms', 'application/x-troff-ms'],
    ['mscml', 'application/mediaservercontrol+xml'],
    ['mseq', 'application/vnd.mseq'],
    ['msf', 'application/vnd.epson.msf'],
    ['msg', 'application/vnd.ms-outlook'],
    ['msh', 'model/mesh'],
    ['msl', 'application/vnd.mobius.msl'],
    ['msty', 'application/vnd.muvee.style'],
    ['mts', 'model/vnd.mts'],
    ['mus', 'application/vnd.musician'],
    ['musicxml', 'application/vnd.recordare.musicxml+xml'],
    ['mv', 'video/x-sgi-movie'],
    ['mvb', 'application/x-msmediaview'],
    ['mwf', 'application/vnd.mfer'],
    ['mxf', 'application/mxf'],
    ['mxl', 'application/vnd.recordare.musicxml'],
    ['mxml', 'application/xv+xml'],
    ['mxs', 'application/vnd.triscape.mxs'],
    ['mxu', 'video/vnd.mpegurl'],
    ['my', 'audio/make'],
    ['mzz', 'application/x-vnd.audioexplosion.mzz'],
    ['n-gage', 'application/vnd.nokia.n-gage.symbian.install'],
    ['n3', 'text/n3'],
    ['nap', 'image/naplps'],
    ['naplps', 'image/naplps'],
    ['nbp', 'application/vnd.wolfram.player'],
    ['nc', 'application/x-netcdf'],
    ['ncm', 'application/vnd.nokia.configuration-message'],
    ['ncx', 'application/x-dtbncx+xml'],
    ['ngdat', 'application/vnd.nokia.n-gage.data'],
    ['nif', 'image/x-niff'],
    ['niff', 'image/x-niff'],
    ['nix', 'application/x-mix-transfer'],
    ['nlu', 'application/vnd.neurolanguage.nlu'],
    ['nml', 'application/vnd.enliven'],
    ['nnd', 'application/vnd.noblenet-directory'],
    ['nns', 'application/vnd.noblenet-sealer'],
    ['nnw', 'application/vnd.noblenet-web'],
    ['npx', 'image/vnd.net-fpx'],
    ['nsc', 'application/x-conference'],
    ['nsf', 'application/vnd.lotus-notes'],
    ['nvd', 'application/x-navidoc'],
    ['nws', 'message/rfc822'],
    ['o', 'application/octet-stream'],
    ['oa2', 'application/vnd.fujitsu.oasys2'],
    ['oa3', 'application/vnd.fujitsu.oasys3'],
    ['oas', 'application/vnd.fujitsu.oasys'],
    ['obd', 'application/x-msbinder'],
    ['oda', 'application/oda'],
    ['odb', 'application/vnd.oasis.opendocument.database'],
    ['odc', 'application/vnd.oasis.opendocument.chart'],
    ['odf', 'application/vnd.oasis.opendocument.formula'],
    ['odft', 'application/vnd.oasis.opendocument.formula-template'],
    ['odg', 'application/vnd.oasis.opendocument.graphics'],
    ['odi', 'application/vnd.oasis.opendocument.image'],
    ['odm', 'application/vnd.oasis.opendocument.text-master'],
    ['odp', 'application/vnd.oasis.opendocument.presentation'],
    ['ods', 'application/vnd.oasis.opendocument.spreadsheet'],
    ['odt', 'application/vnd.oasis.opendocument.text'],
    ['oga', 'audio/ogg'],
    ['ogv', 'video/ogg'],
    ['ogx', 'application/ogg'],
    ['omc', 'application/x-omc'],
    ['omcd', 'application/x-omcdatamaker'],
    ['omcr', 'application/x-omcregerator'],
    ['onetoc', 'application/onenote'],
    ['opf', 'application/oebps-package+xml'],
    ['org', 'application/vnd.lotus-organizer'],
    ['osf', 'application/vnd.yamaha.openscoreformat'],
    ['osfpvg', 'application/vnd.yamaha.openscoreformat.osfpvg+xml'],
    ['otc', 'application/vnd.oasis.opendocument.chart-template'],
    ['otf', 'application/x-font-otf'],
    ['otg', 'application/vnd.oasis.opendocument.graphics-template'],
    ['oth', 'application/vnd.oasis.opendocument.text-web'],
    ['oti', 'application/vnd.oasis.opendocument.image-template'],
    ['otp', 'application/vnd.oasis.opendocument.presentation-template'],
    ['ots', 'application/vnd.oasis.opendocument.spreadsheet-template'],
    ['ott', 'application/vnd.oasis.opendocument.text-template'],
    ['oxt', 'application/vnd.openofficeorg.extension'],
    ['p', 'text/x-pascal'],
    ['p10', ['application/pkcs10', 'application/x-pkcs10']],
    ['p12', ['application/pkcs-12', 'application/x-pkcs12']],
    ['p7a', 'application/x-pkcs7-signature'],
    ['p7b', 'application/x-pkcs7-certificates'],
    ['p7c', ['application/pkcs7-mime', 'application/x-pkcs7-mime']],
    ['p7m', ['application/pkcs7-mime', 'application/x-pkcs7-mime']],
    ['p7r', 'application/x-pkcs7-certreqresp'],
    ['p7s', ['application/pkcs7-signature', 'application/x-pkcs7-signature']],
    ['p8', 'application/pkcs8'],
    ['par', 'text/plain-bas'],
    ['part', 'application/pro_eng'],
    ['pas', 'text/pascal'],
    ['paw', 'application/vnd.pawaafile'],
    ['pbd', 'application/vnd.powerbuilder6'],
    ['pbm', 'image/x-portable-bitmap'],
    ['pcf', 'application/x-font-pcf'],
    ['pcl', ['application/vnd.hp-pcl', 'application/x-pcl']],
    ['pclxl', 'application/vnd.hp-pclxl'],
    ['pct', 'image/x-pict'],
    ['pcurl', 'application/vnd.curl.pcurl'],
    ['pcx', 'image/x-pcx'],
    ['pdb', ['application/vnd.palm', 'chemical/x-pdb']],
    ['pdf', 'application/pdf'],
    ['pfa', 'application/x-font-type1'],
    ['pfr', 'application/font-tdpfr'],
    ['pfunk', ['audio/make', 'audio/make.my.funk']],
    ['pfx', 'application/x-pkcs12'],
    ['pgm', ['image/x-portable-graymap', 'image/x-portable-greymap']],
    ['pgn', 'application/x-chess-pgn'],
    ['pgp', 'application/pgp-signature'],
    ['pic', ['image/pict', 'image/x-pict']],
    ['pict', 'image/pict'],
    ['pkg', 'application/x-newton-compatible-pkg'],
    ['pki', 'application/pkixcmp'],
    ['pkipath', 'application/pkix-pkipath'],
    ['pko', ['application/ynd.ms-pkipko', 'application/vnd.ms-pki.pko']],
    ['pl', ['text/plain', 'text/x-script.perl']],
    ['plb', 'application/vnd.3gpp.pic-bw-large'],
    ['plc', 'application/vnd.mobius.plc'],
    ['plf', 'application/vnd.pocketlearn'],
    ['pls', 'application/pls+xml'],
    ['plx', 'application/x-pixclscript'],
    ['pm', ['text/x-script.perl-module', 'image/x-xpixmap']],
    ['pm4', 'application/x-pagemaker'],
    ['pm5', 'application/x-pagemaker'],
    ['pma', 'application/x-perfmon'],
    ['pmc', 'application/x-perfmon'],
    ['pml', ['application/vnd.ctc-posml', 'application/x-perfmon']],
    ['pmr', 'application/x-perfmon'],
    ['pmw', 'application/x-perfmon'],
    ['png', 'image/png'],
    ['pnm', ['application/x-portable-anymap', 'image/x-portable-anymap']],
    ['portpkg', 'application/vnd.macports.portpkg'],
    ['pot', ['application/vnd.ms-powerpoint', 'application/mspowerpoint']],
    ['potm', 'application/vnd.ms-powerpoint.template.macroenabled.12'],
    ['potx', 'application/vnd.openxmlformats-officedocument.presentationml.template'],
    ['pov', 'model/x-pov'],
    ['ppa', 'application/vnd.ms-powerpoint'],
    ['ppam', 'application/vnd.ms-powerpoint.addin.macroenabled.12'],
    ['ppd', 'application/vnd.cups-ppd'],
    ['ppm', 'image/x-portable-pixmap'],
    ['pps', ['application/vnd.ms-powerpoint', 'application/mspowerpoint']],
    ['ppsm', 'application/vnd.ms-powerpoint.slideshow.macroenabled.12'],
    ['ppsx', 'application/vnd.openxmlformats-officedocument.presentationml.slideshow'],
    ['ppt', ['application/vnd.ms-powerpoint', 'application/mspowerpoint', 'application/powerpoint', 'application/x-mspowerpoint']],
    ['pptm', 'application/vnd.ms-powerpoint.presentation.macroenabled.12'],
    ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['ppz', 'application/mspowerpoint'],
    ['prc', 'application/x-mobipocket-ebook'],
    ['pre', ['application/vnd.lotus-freelance', 'application/x-freelance']],
    ['prf', 'application/pics-rules'],
    ['prt', 'application/pro_eng'],
    ['ps', 'application/postscript'],
    ['psb', 'application/vnd.3gpp.pic-bw-small'],
    ['psd', ['application/octet-stream', 'image/vnd.adobe.photoshop']],
    ['psf', 'application/x-font-linux-psf'],
    ['pskcxml', 'application/pskc+xml'],
    ['ptid', 'application/vnd.pvi.ptid1'],
    ['pub', 'application/x-mspublisher'],
    ['pvb', 'application/vnd.3gpp.pic-bw-var'],
    ['pvu', 'paleovu/x-pv'],
    ['pwn', 'application/vnd.3m.post-it-notes'],
    ['pwz', 'application/vnd.ms-powerpoint'],
    ['py', 'text/x-script.phyton'],
    ['pya', 'audio/vnd.ms-playready.media.pya'],
    ['pyc', 'applicaiton/x-bytecode.python'],
    ['pyv', 'video/vnd.ms-playready.media.pyv'],
    ['qam', 'application/vnd.epson.quickanime'],
    ['qbo', 'application/vnd.intu.qbo'],
    ['qcp', 'audio/vnd.qcelp'],
    ['qd3', 'x-world/x-3dmf'],
    ['qd3d', 'x-world/x-3dmf'],
    ['qfx', 'application/vnd.intu.qfx'],
    ['qif', 'image/x-quicktime'],
    ['qps', 'application/vnd.publishare-delta-tree'],
    ['qt', 'video/quicktime'],
    ['qtc', 'video/x-qtc'],
    ['qti', 'image/x-quicktime'],
    ['qtif', 'image/x-quicktime'],
    ['qxd', 'application/vnd.quark.quarkxpress'],
    ['ra', ['audio/x-realaudio', 'audio/x-pn-realaudio', 'audio/x-pn-realaudio-plugin']],
    ['ram', 'audio/x-pn-realaudio'],
    ['rar', 'application/x-rar-compressed'],
    ['ras', ['image/cmu-raster', 'application/x-cmu-raster', 'image/x-cmu-raster']],
    ['rast', 'image/cmu-raster'],
    ['rcprofile', 'application/vnd.ipunplugged.rcprofile'],
    ['rdf', 'application/rdf+xml'],
    ['rdz', 'application/vnd.data-vision.rdz'],
    ['rep', 'application/vnd.businessobjects'],
    ['res', 'application/x-dtbresource+xml'],
    ['rexx', 'text/x-script.rexx'],
    ['rf', 'image/vnd.rn-realflash'],
    ['rgb', 'image/x-rgb'],
    ['rif', 'application/reginfo+xml'],
    ['rip', 'audio/vnd.rip'],
    ['rl', 'application/resource-lists+xml'],
    ['rlc', 'image/vnd.fujixerox.edmics-rlc'],
    ['rld', 'application/resource-lists-diff+xml'],
    ['rm', ['application/vnd.rn-realmedia', 'audio/x-pn-realaudio']],
    ['rmi', 'audio/mid'],
    ['rmm', 'audio/x-pn-realaudio'],
    ['rmp', ['audio/x-pn-realaudio-plugin', 'audio/x-pn-realaudio']],
    ['rms', 'application/vnd.jcp.javame.midlet-rms'],
    ['rnc', 'application/relax-ng-compact-syntax'],
    ['rng', ['application/ringing-tones', 'application/vnd.nokia.ringing-tone']],
    ['rnx', 'application/vnd.rn-realplayer'],
    ['roff', 'application/x-troff'],
    ['rp', 'image/vnd.rn-realpix'],
    ['rp9', 'application/vnd.cloanto.rp9'],
    ['rpm', 'audio/x-pn-realaudio-plugin'],
    ['rpss', 'application/vnd.nokia.radio-presets'],
    ['rpst', 'application/vnd.nokia.radio-preset'],
    ['rq', 'application/sparql-query'],
    ['rs', 'application/rls-services+xml'],
    ['rsd', 'application/rsd+xml'],
    ['rt', ['text/richtext', 'text/vnd.rn-realtext']],
    ['rtf', ['application/rtf', 'text/richtext', 'application/x-rtf']],
    ['rtx', ['text/richtext', 'application/rtf']],
    ['rv', 'video/vnd.rn-realvideo'],
    ['s', 'text/x-asm'],
    ['s3m', 'audio/s3m'],
    ['saf', 'application/vnd.yamaha.smaf-audio'],
    ['saveme', 'application/octet-stream'],
    ['sbk', 'application/x-tbook'],
    ['sbml', 'application/sbml+xml'],
    ['sc', 'application/vnd.ibm.secure-container'],
    ['scd', 'application/x-msschedule'],
    ['scm', ['application/vnd.lotus-screencam', 'video/x-scm', 'text/x-script.guile', 'application/x-lotusscreencam', 'text/x-script.scheme']],
    ['scq', 'application/scvp-cv-request'],
    ['scs', 'application/scvp-cv-response'],
    ['sct', 'text/scriptlet'],
    ['scurl', 'text/vnd.curl.scurl'],
    ['sda', 'application/vnd.stardivision.draw'],
    ['sdc', 'application/vnd.stardivision.calc'],
    ['sdd', 'application/vnd.stardivision.impress'],
    ['sdkm', 'application/vnd.solent.sdkm+xml'],
    ['sdml', 'text/plain'],
    ['sdp', ['application/sdp', 'application/x-sdp']],
    ['sdr', 'application/sounder'],
    ['sdw', 'application/vnd.stardivision.writer'],
    ['sea', ['application/sea', 'application/x-sea']],
    ['see', 'application/vnd.seemail'],
    ['seed', 'application/vnd.fdsn.seed'],
    ['sema', 'application/vnd.sema'],
    ['semd', 'application/vnd.semd'],
    ['semf', 'application/vnd.semf'],
    ['ser', 'application/java-serialized-object'],
    ['set', 'application/set'],
    ['setpay', 'application/set-payment-initiation'],
    ['setreg', 'application/set-registration-initiation'],
    ['sfd-hdstx', 'application/vnd.hydrostatix.sof-data'],
    ['sfs', 'application/vnd.spotfire.sfs'],
    ['sgl', 'application/vnd.stardivision.writer-global'],
    ['sgm', ['text/sgml', 'text/x-sgml']],
    ['sgml', ['text/sgml', 'text/x-sgml']],
    ['sh', ['application/x-shar', 'application/x-bsh', 'application/x-sh', 'text/x-script.sh']],
    ['shar', ['application/x-bsh', 'application/x-shar']],
    ['shf', 'application/shf+xml'],
    ['shtml', ['text/html', 'text/x-server-parsed-html']],
    ['sid', 'audio/x-psid'],
    ['sis', 'application/vnd.symbian.install'],
    ['sit', ['application/x-stuffit', 'application/x-sit']],
    ['sitx', 'application/x-stuffitx'],
    ['skd', 'application/x-koan'],
    ['skm', 'application/x-koan'],
    ['skp', ['application/vnd.koan', 'application/x-koan']],
    ['skt', 'application/x-koan'],
    ['sl', 'application/x-seelogo'],
    ['sldm', 'application/vnd.ms-powerpoint.slide.macroenabled.12'],
    ['sldx', 'application/vnd.openxmlformats-officedocument.presentationml.slide'],
    ['slt', 'application/vnd.epson.salt'],
    ['sm', 'application/vnd.stepmania.stepchart'],
    ['smf', 'application/vnd.stardivision.math'],
    ['smi', ['application/smil', 'application/smil+xml']],
    ['smil', 'application/smil'],
    ['snd', ['audio/basic', 'audio/x-adpcm']],
    ['snf', 'application/x-font-snf'],
    ['sol', 'application/solids'],
    ['spc', ['text/x-speech', 'application/x-pkcs7-certificates']],
    ['spf', 'application/vnd.yamaha.smaf-phrase'],
    ['spl', ['application/futuresplash', 'application/x-futuresplash']],
    ['spot', 'text/vnd.in3d.spot'],
    ['spp', 'application/scvp-vp-response'],
    ['spq', 'application/scvp-vp-request'],
    ['spr', 'application/x-sprite'],
    ['sprite', 'application/x-sprite'],
    ['src', 'application/x-wais-source'],
    ['sru', 'application/sru+xml'],
    ['srx', 'application/sparql-results+xml'],
    ['sse', 'application/vnd.kodak-descriptor'],
    ['ssf', 'application/vnd.epson.ssf'],
    ['ssi', 'text/x-server-parsed-html'],
    ['ssm', 'application/streamingmedia'],
    ['ssml', 'application/ssml+xml'],
    ['sst', ['application/vnd.ms-pkicertstore', 'application/vnd.ms-pki.certstore']],
    ['st', 'application/vnd.sailingtracker.track'],
    ['stc', 'application/vnd.sun.xml.calc.template'],
    ['std', 'application/vnd.sun.xml.draw.template'],
    ['step', 'application/step'],
    ['stf', 'application/vnd.wt.stf'],
    ['sti', 'application/vnd.sun.xml.impress.template'],
    ['stk', 'application/hyperstudio'],
    ['stl', ['application/vnd.ms-pkistl', 'application/sla', 'application/vnd.ms-pki.stl', 'application/x-navistyle']],
    ['stm', 'text/html'],
    ['stp', 'application/step'],
    ['str', 'application/vnd.pg.format'],
    ['stw', 'application/vnd.sun.xml.writer.template'],
    ['sub', 'image/vnd.dvb.subtitle'],
    ['sus', 'application/vnd.sus-calendar'],
    ['sv4cpio', 'application/x-sv4cpio'],
    ['sv4crc', 'application/x-sv4crc'],
    ['svc', 'application/vnd.dvb.service'],
    ['svd', 'application/vnd.svd'],
    ['svf', ['image/vnd.dwg', 'image/x-dwg']],
    ['svg', 'image/svg+xml'],
    ['svr', ['x-world/x-svr', 'application/x-world']],
    ['swf', 'application/x-shockwave-flash'],
    ['swi', 'application/vnd.aristanetworks.swi'],
    ['sxc', 'application/vnd.sun.xml.calc'],
    ['sxd', 'application/vnd.sun.xml.draw'],
    ['sxg', 'application/vnd.sun.xml.writer.global'],
    ['sxi', 'application/vnd.sun.xml.impress'],
    ['sxm', 'application/vnd.sun.xml.math'],
    ['sxw', 'application/vnd.sun.xml.writer'],
    ['t', ['text/troff', 'application/x-troff']],
    ['talk', 'text/x-speech'],
    ['tao', 'application/vnd.tao.intent-module-archive'],
    ['tar', 'application/x-tar'],
    ['tbk', ['application/toolbook', 'application/x-tbook']],
    ['tcap', 'application/vnd.3gpp2.tcap'],
    ['tcl', ['text/x-script.tcl', 'application/x-tcl']],
    ['tcsh', 'text/x-script.tcsh'],
    ['teacher', 'application/vnd.smart.teacher'],
    ['tei', 'application/tei+xml'],
    ['tex', 'application/x-tex'],
    ['texi', 'application/x-texinfo'],
    ['texinfo', 'application/x-texinfo'],
    ['text', ['application/plain', 'text/plain']],
    ['tfi', 'application/thraud+xml'],
    ['tfm', 'application/x-tex-tfm'],
    ['tgz', ['application/gnutar', 'application/x-compressed']],
    ['thmx', 'application/vnd.ms-officetheme'],
    ['tif', ['image/tiff', 'image/x-tiff']],
    ['tiff', ['image/tiff', 'image/x-tiff']],
    ['tmo', 'application/vnd.tmobile-livetv'],
    ['torrent', 'application/x-bittorrent'],
    ['tpl', 'application/vnd.groove-tool-template'],
    ['tpt', 'application/vnd.trid.tpt'],
    ['tr', 'application/x-troff'],
    ['tra', 'application/vnd.trueapp'],
    ['trm', 'application/x-msterminal'],
    ['tsd', 'application/timestamped-data'],
    ['tsi', 'audio/tsp-audio'],
    ['tsp', ['application/dsptype', 'audio/tsplayer']],
    ['tsv', 'text/tab-separated-values'],
    ['ttf', 'application/x-font-ttf'],
    ['ttl', 'text/turtle'],
    ['turbot', 'image/florian'],
    ['twd', 'application/vnd.simtech-mindmapper'],
    ['txd', 'application/vnd.genomatix.tuxedo'],
    ['txf', 'application/vnd.mobius.txf'],
    ['txt', 'text/plain'],
    ['ufd', 'application/vnd.ufdl'],
    ['uil', 'text/x-uil'],
    ['uls', 'text/iuls'],
    ['umj', 'application/vnd.umajin'],
    ['uni', 'text/uri-list'],
    ['unis', 'text/uri-list'],
    ['unityweb', 'application/vnd.unity'],
    ['unv', 'application/i-deas'],
    ['uoml', 'application/vnd.uoml+xml'],
    ['uri', 'text/uri-list'],
    ['uris', 'text/uri-list'],
    ['ustar', ['application/x-ustar', 'multipart/x-ustar']],
    ['utz', 'application/vnd.uiq.theme'],
    ['uu', ['application/octet-stream', 'text/x-uuencode']],
    ['uue', 'text/x-uuencode'],
    ['uva', 'audio/vnd.dece.audio'],
    ['uvh', 'video/vnd.dece.hd'],
    ['uvi', 'image/vnd.dece.graphic'],
    ['uvm', 'video/vnd.dece.mobile'],
    ['uvp', 'video/vnd.dece.pd'],
    ['uvs', 'video/vnd.dece.sd'],
    ['uvu', 'video/vnd.uvvu.mp4'],
    ['uvv', 'video/vnd.dece.video'],
    ['vcd', 'application/x-cdlink'],
    ['vcf', 'text/x-vcard'],
    ['vcg', 'application/vnd.groove-vcard'],
    ['vcs', 'text/x-vcalendar'],
    ['vcx', 'application/vnd.vcx'],
    ['vda', 'application/vda'],
    ['vdo', 'video/vdo'],
    ['vew', 'application/groupwise'],
    ['vis', 'application/vnd.visionary'],
    ['viv', ['video/vivo', 'video/vnd.vivo']],
    ['vivo', ['video/vivo', 'video/vnd.vivo']],
    ['vmd', 'application/vocaltec-media-desc'],
    ['vmf', 'application/vocaltec-media-file'],
    ['voc', ['audio/voc', 'audio/x-voc']],
    ['vos', 'video/vosaic'],
    ['vox', 'audio/voxware'],
    ['vqe', 'audio/x-twinvq-plugin'],
    ['vqf', 'audio/x-twinvq'],
    ['vql', 'audio/x-twinvq-plugin'],
    ['vrml', ['model/vrml', 'x-world/x-vrml', 'application/x-vrml']],
    ['vrt', 'x-world/x-vrt'],
    ['vsd', ['application/vnd.visio', 'application/x-visio']],
    ['vsf', 'application/vnd.vsf'],
    ['vst', 'application/x-visio'],
    ['vsw', 'application/x-visio'],
    ['vtu', 'model/vnd.vtu'],
    ['vxml', 'application/voicexml+xml'],
    ['w60', 'application/wordperfect6.0'],
    ['w61', 'application/wordperfect6.1'],
    ['w6w', 'application/msword'],
    ['wad', 'application/x-doom'],
    ['wav', ['audio/wav', 'audio/x-wav']],
    ['wax', 'audio/x-ms-wax'],
    ['wb1', 'application/x-qpro'],
    ['wbmp', 'image/vnd.wap.wbmp'],
    ['wbs', 'application/vnd.criticaltools.wbs+xml'],
    ['wbxml', 'application/vnd.wap.wbxml'],
    ['wcm', 'application/vnd.ms-works'],
    ['wdb', 'application/vnd.ms-works'],
    ['web', 'application/vnd.xara'],
    ['weba', 'audio/webm'],
    ['webm', 'video/webm'],
    ['webp', 'image/webp'],
    ['wg', 'application/vnd.pmi.widget'],
    ['wgt', 'application/widget'],
    ['wiz', 'application/msword'],
    ['wk1', 'application/x-123'],
    ['wks', 'application/vnd.ms-works'],
    ['wm', 'video/x-ms-wm'],
    ['wma', 'audio/x-ms-wma'],
    ['wmd', 'application/x-ms-wmd'],
    ['wmf', ['windows/metafile', 'application/x-msmetafile']],
    ['wml', 'text/vnd.wap.wml'],
    ['wmlc', 'application/vnd.wap.wmlc'],
    ['wmls', 'text/vnd.wap.wmlscript'],
    ['wmlsc', 'application/vnd.wap.wmlscriptc'],
    ['wmv', 'video/x-ms-wmv'],
    ['wmx', 'video/x-ms-wmx'],
    ['wmz', 'application/x-ms-wmz'],
    ['woff', 'application/x-font-woff'],
    ['word', 'application/msword'],
    ['wp', 'application/wordperfect'],
    ['wp5', ['application/wordperfect', 'application/wordperfect6.0']],
    ['wp6', 'application/wordperfect'],
    ['wpd', ['application/wordperfect', 'application/vnd.wordperfect', 'application/x-wpwin']],
    ['wpl', 'application/vnd.ms-wpl'],
    ['wps', 'application/vnd.ms-works'],
    ['wq1', 'application/x-lotus'],
    ['wqd', 'application/vnd.wqd'],
    ['wri', ['application/mswrite', 'application/x-wri', 'application/x-mswrite']],
    ['wrl', ['model/vrml', 'x-world/x-vrml', 'application/x-world']],
    ['wrz', ['model/vrml', 'x-world/x-vrml']],
    ['wsc', 'text/scriplet'],
    ['wsdl', 'application/wsdl+xml'],
    ['wspolicy', 'application/wspolicy+xml'],
    ['wsrc', 'application/x-wais-source'],
    ['wtb', 'application/vnd.webturbo'],
    ['wtk', 'application/x-wintalk'],
    ['wvx', 'video/x-ms-wvx'],
    ['x-png', 'image/png'],
    ['x3d', 'application/vnd.hzn-3d-crossword'],
    ['xaf', 'x-world/x-vrml'],
    ['xap', 'application/x-silverlight-app'],
    ['xar', 'application/vnd.xara'],
    ['xbap', 'application/x-ms-xbap'],
    ['xbd', 'application/vnd.fujixerox.docuworks.binder'],
    ['xbm', ['image/xbm', 'image/x-xbm', 'image/x-xbitmap']],
    ['xdf', 'application/xcap-diff+xml'],
    ['xdm', 'application/vnd.syncml.dm+xml'],
    ['xdp', 'application/vnd.adobe.xdp+xml'],
    ['xdr', 'video/x-amt-demorun'],
    ['xdssc', 'application/dssc+xml'],
    ['xdw', 'application/vnd.fujixerox.docuworks'],
    ['xenc', 'application/xenc+xml'],
    ['xer', 'application/patch-ops-error+xml'],
    ['xfdf', 'application/vnd.adobe.xfdf'],
    ['xfdl', 'application/vnd.xfdl'],
    ['xgz', 'xgl/drawing'],
    ['xhtml', 'application/xhtml+xml'],
    ['xif', 'image/vnd.xiff'],
    ['xl', 'application/excel'],
    ['xla', ['application/vnd.ms-excel', 'application/excel', 'application/x-msexcel', 'application/x-excel']],
    ['xlam', 'application/vnd.ms-excel.addin.macroenabled.12'],
    ['xlb', ['application/excel', 'application/vnd.ms-excel', 'application/x-excel']],
    ['xlc', ['application/vnd.ms-excel', 'application/excel', 'application/x-excel']],
    ['xld', ['application/excel', 'application/x-excel']],
    ['xlk', ['application/excel', 'application/x-excel']],
    ['xll', ['application/excel', 'application/vnd.ms-excel', 'application/x-excel']],
    ['xlm', ['application/vnd.ms-excel', 'application/excel', 'application/x-excel']],
    ['xls', ['application/vnd.ms-excel', 'application/excel', 'application/x-msexcel', 'application/x-excel']],
    ['xlsb', 'application/vnd.ms-excel.sheet.binary.macroenabled.12'],
    ['xlsm', 'application/vnd.ms-excel.sheet.macroenabled.12'],
    ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['xlt', ['application/vnd.ms-excel', 'application/excel', 'application/x-excel']],
    ['xltm', 'application/vnd.ms-excel.template.macroenabled.12'],
    ['xltx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.template'],
    ['xlv', ['application/excel', 'application/x-excel']],
    ['xlw', ['application/vnd.ms-excel', 'application/excel', 'application/x-msexcel', 'application/x-excel']],
    ['xm', 'audio/xm'],
    ['xml', ['application/xml', 'text/xml', 'application/atom+xml', 'application/rss+xml']],
    ['xmz', 'xgl/movie'],
    ['xo', 'application/vnd.olpc-sugar'],
    ['xof', 'x-world/x-vrml'],
    ['xop', 'application/xop+xml'],
    ['xpi', 'application/x-xpinstall'],
    ['xpix', 'application/x-vnd.ls-xpix'],
    ['xpm', ['image/xpm', 'image/x-xpixmap']],
    ['xpr', 'application/vnd.is-xpr'],
    ['xps', 'application/vnd.ms-xpsdocument'],
    ['xpw', 'application/vnd.intercon.formnet'],
    ['xslt', 'application/xslt+xml'],
    ['xsm', 'application/vnd.syncml+xml'],
    ['xspf', 'application/xspf+xml'],
    ['xsr', 'video/x-amt-showrun'],
    ['xul', 'application/vnd.mozilla.xul+xml'],
    ['xwd', ['image/x-xwd', 'image/x-xwindowdump']],
    ['xyz', ['chemical/x-xyz', 'chemical/x-pdb']],
    ['yang', 'application/yang'],
    ['yin', 'application/yin+xml'],
    ['z', ['application/x-compressed', 'application/x-compress']],
    ['zaz', 'application/vnd.zzazz.deck+xml'],
    ['zip', ['application/zip', 'multipart/x-zip', 'application/x-zip-compressed', 'application/x-compressed']],
    ['zir', 'application/vnd.zul'],
    ['zmm', 'application/vnd.handheld-entertainment+xml'],
    ['zoo', 'application/octet-stream'],
    ['zsh', 'text/x-script.zsh']
]);

module.exports = {
    detectMimeType(filename) {
        if (!filename) {
            return defaultMimeType;
        }

        let parsed = path.parse(filename);
        let extension = (parsed.ext.substr(1) || parsed.name || '')
            .split('?')
            .shift()
            .trim()
            .toLowerCase();
        let value = defaultMimeType;

        if (extensions.has(extension)) {
            value = extensions.get(extension);
        }

        if (Array.isArray(value)) {
            return value[0];
        }
        return value;
    },

    detectExtension(mimeType) {
        if (!mimeType) {
            return defaultExtension;
        }
        let parts = (mimeType || '')
            .toLowerCase()
            .trim()
            .split('/');
        let rootType = parts.shift().trim();
        let subType = parts.join('/').trim();

        if (mimeTypes.has(rootType + '/' + subType)) {
            let value = mimeTypes.get(rootType + '/' + subType);
            if (Array.isArray(value)) {
                return value[0];
            }
            return value;
        }

        switch (rootType) {
            case 'text':
                return 'txt';
            default:
                return 'bin';
        }
    }
};


/***/ }),

/***/ 8509:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";
/* eslint no-undefined: 0, prefer-spread: 0, no-control-regex: 0 */



const crypto = __webpack_require__(6417);
const os = __webpack_require__(2087);
const fs = __webpack_require__(5747);
const punycode = __webpack_require__(4213);
const PassThrough = __webpack_require__(2413).PassThrough;
const shared = __webpack_require__(2673);

const mimeFuncs = __webpack_require__(994);
const qp = __webpack_require__(9716);
const base64 = __webpack_require__(4017);
const addressparser = __webpack_require__(7382);
const fetch = __webpack_require__(9106);
const LastNewline = __webpack_require__(3368);

/**
 * Creates a new mime tree node. Assumes 'multipart/*' as the content type
 * if it is a branch, anything else counts as leaf. If rootNode is missing from
 * the options, assumes this is the root.
 *
 * @param {String} contentType Define the content type for the node. Can be left blank for attachments (derived from filename)
 * @param {Object} [options] optional options
 * @param {Object} [options.rootNode] root node for this tree
 * @param {Object} [options.parentNode] immediate parent for this node
 * @param {Object} [options.filename] filename for an attachment node
 * @param {String} [options.baseBoundary] shared part of the unique multipart boundary
 * @param {Boolean} [options.keepBcc] If true, do not exclude Bcc from the generated headers
 * @param {Function} [options.normalizeHeaderKey] method to normalize header keys for custom caseing
 * @param {String} [options.textEncoding] either 'Q' (the default) or 'B'
 */
class MimeNode {
    constructor(contentType, options) {
        this.nodeCounter = 0;

        options = options || {};

        /**
         * shared part of the unique multipart boundary
         */
        this.baseBoundary = options.baseBoundary || crypto.randomBytes(8).toString('hex');
        this.boundaryPrefix = options.boundaryPrefix || '--_NmP';

        this.disableFileAccess = !!options.disableFileAccess;
        this.disableUrlAccess = !!options.disableUrlAccess;

        this.normalizeHeaderKey = options.normalizeHeaderKey;

        /**
         * If date headers is missing and current node is the root, this value is used instead
         */
        this.date = new Date();

        /**
         * Root node for current mime tree
         */
        this.rootNode = options.rootNode || this;

        /**
         * If true include Bcc in generated headers (if available)
         */
        this.keepBcc = !!options.keepBcc;

        /**
         * If filename is specified but contentType is not (probably an attachment)
         * detect the content type from filename extension
         */
        if (options.filename) {
            /**
             * Filename for this node. Useful with attachments
             */
            this.filename = options.filename;
            if (!contentType) {
                contentType = mimeFuncs.detectMimeType(this.filename.split('.').pop());
            }
        }

        /**
         * Indicates which encoding should be used for header strings: "Q" or "B"
         */
        this.textEncoding = (options.textEncoding || '').toString().trim().charAt(0).toUpperCase();

        /**
         * Immediate parent for this node (or undefined if not set)
         */
        this.parentNode = options.parentNode;

        /**
         * Hostname for default message-id values
         */
        this.hostname = options.hostname;

        /**
         * An array for possible child nodes
         */
        this.childNodes = [];

        /**
         * Used for generating unique boundaries (prepended to the shared base)
         */
        this._nodeId = ++this.rootNode.nodeCounter;

        /**
         * A list of header values for this node in the form of [{key:'', value:''}]
         */
        this._headers = [];

        /**
         * True if the content only uses ASCII printable characters
         * @type {Boolean}
         */
        this._isPlainText = false;

        /**
         * True if the content is plain text but has longer lines than allowed
         * @type {Boolean}
         */
        this._hasLongLines = false;

        /**
         * If set, use instead this value for envelopes instead of generating one
         * @type {Boolean}
         */
        this._envelope = false;

        /**
         * If set then use this value as the stream content instead of building it
         * @type {String|Buffer|Stream}
         */
        this._raw = false;

        /**
         * Additional transform streams that the message will be piped before
         * exposing by createReadStream
         * @type {Array}
         */
        this._transforms = [];

        /**
         * Additional process functions that the message will be piped through before
         * exposing by createReadStream. These functions are run after transforms
         * @type {Array}
         */
        this._processFuncs = [];

        /**
         * If content type is set (or derived from the filename) add it to headers
         */
        if (contentType) {
            this.setHeader('Content-Type', contentType);
        }
    }

    /////// PUBLIC METHODS

    /**
     * Creates and appends a child node.Arguments provided are passed to MimeNode constructor
     *
     * @param {String} [contentType] Optional content type
     * @param {Object} [options] Optional options object
     * @return {Object} Created node object
     */
    createChild(contentType, options) {
        if (!options && typeof contentType === 'object') {
            options = contentType;
            contentType = undefined;
        }
        let node = new MimeNode(contentType, options);
        this.appendChild(node);
        return node;
    }

    /**
     * Appends an existing node to the mime tree. Removes the node from an existing
     * tree if needed
     *
     * @param {Object} childNode node to be appended
     * @return {Object} Appended node object
     */
    appendChild(childNode) {
        if (childNode.rootNode !== this.rootNode) {
            childNode.rootNode = this.rootNode;
            childNode._nodeId = ++this.rootNode.nodeCounter;
        }

        childNode.parentNode = this;

        this.childNodes.push(childNode);
        return childNode;
    }

    /**
     * Replaces current node with another node
     *
     * @param {Object} node Replacement node
     * @return {Object} Replacement node
     */
    replace(node) {
        if (node === this) {
            return this;
        }

        this.parentNode.childNodes.forEach((childNode, i) => {
            if (childNode === this) {
                node.rootNode = this.rootNode;
                node.parentNode = this.parentNode;
                node._nodeId = this._nodeId;

                this.rootNode = this;
                this.parentNode = undefined;

                node.parentNode.childNodes[i] = node;
            }
        });

        return node;
    }

    /**
     * Removes current node from the mime tree
     *
     * @return {Object} removed node
     */
    remove() {
        if (!this.parentNode) {
            return this;
        }

        for (let i = this.parentNode.childNodes.length - 1; i >= 0; i--) {
            if (this.parentNode.childNodes[i] === this) {
                this.parentNode.childNodes.splice(i, 1);
                this.parentNode = undefined;
                this.rootNode = this;
                return this;
            }
        }
    }

    /**
     * Sets a header value. If the value for selected key exists, it is overwritten.
     * You can set multiple values as well by using [{key:'', value:''}] or
     * {key: 'value'} as the first argument.
     *
     * @param {String|Array|Object} key Header key or a list of key value pairs
     * @param {String} value Header value
     * @return {Object} current node
     */
    setHeader(key, value) {
        let added = false,
            headerValue;

        // Allow setting multiple headers at once
        if (!value && key && typeof key === 'object') {
            // allow {key:'content-type', value: 'text/plain'}
            if (key.key && 'value' in key) {
                this.setHeader(key.key, key.value);
            } else if (Array.isArray(key)) {
                // allow [{key:'content-type', value: 'text/plain'}]
                key.forEach(i => {
                    this.setHeader(i.key, i.value);
                });
            } else {
                // allow {'content-type': 'text/plain'}
                Object.keys(key).forEach(i => {
                    this.setHeader(i, key[i]);
                });
            }
            return this;
        }

        key = this._normalizeHeaderKey(key);

        headerValue = {
            key,
            value
        };

        // Check if the value exists and overwrite
        for (let i = 0, len = this._headers.length; i < len; i++) {
            if (this._headers[i].key === key) {
                if (!added) {
                    // replace the first match
                    this._headers[i] = headerValue;
                    added = true;
                } else {
                    // remove following matches
                    this._headers.splice(i, 1);
                    i--;
                    len--;
                }
            }
        }

        // match not found, append the value
        if (!added) {
            this._headers.push(headerValue);
        }

        return this;
    }

    /**
     * Adds a header value. If the value for selected key exists, the value is appended
     * as a new field and old one is not touched.
     * You can set multiple values as well by using [{key:'', value:''}] or
     * {key: 'value'} as the first argument.
     *
     * @param {String|Array|Object} key Header key or a list of key value pairs
     * @param {String} value Header value
     * @return {Object} current node
     */
    addHeader(key, value) {
        // Allow setting multiple headers at once
        if (!value && key && typeof key === 'object') {
            // allow {key:'content-type', value: 'text/plain'}
            if (key.key && key.value) {
                this.addHeader(key.key, key.value);
            } else if (Array.isArray(key)) {
                // allow [{key:'content-type', value: 'text/plain'}]
                key.forEach(i => {
                    this.addHeader(i.key, i.value);
                });
            } else {
                // allow {'content-type': 'text/plain'}
                Object.keys(key).forEach(i => {
                    this.addHeader(i, key[i]);
                });
            }
            return this;
        } else if (Array.isArray(value)) {
            value.forEach(val => {
                this.addHeader(key, val);
            });
            return this;
        }

        this._headers.push({
            key: this._normalizeHeaderKey(key),
            value
        });

        return this;
    }

    /**
     * Retrieves the first mathcing value of a selected key
     *
     * @param {String} key Key to search for
     * @retun {String} Value for the key
     */
    getHeader(key) {
        key = this._normalizeHeaderKey(key);
        for (let i = 0, len = this._headers.length; i < len; i++) {
            if (this._headers[i].key === key) {
                return this._headers[i].value;
            }
        }
    }

    /**
     * Sets body content for current node. If the value is a string, charset is added automatically
     * to Content-Type (if it is text/*). If the value is a Buffer, you need to specify
     * the charset yourself
     *
     * @param (String|Buffer) content Body content
     * @return {Object} current node
     */
    setContent(content) {
        this.content = content;
        if (typeof this.content.pipe === 'function') {
            // pre-stream handler. might be triggered if a stream is set as content
            // and 'error' fires before anything is done with this stream
            this._contentErrorHandler = err => {
                this.content.removeListener('error', this._contentErrorHandler);
                this.content = err;
            };
            this.content.once('error', this._contentErrorHandler);
        } else if (typeof this.content === 'string') {
            this._isPlainText = mimeFuncs.isPlainText(this.content);
            if (this._isPlainText && mimeFuncs.hasLongerLines(this.content, 76)) {
                // If there are lines longer than 76 symbols/bytes do not use 7bit
                this._hasLongLines = true;
            }
        }
        return this;
    }

    build(callback) {
        let promise;

        if (!callback) {
            promise = new Promise((resolve, reject) => {
                callback = shared.callbackPromise(resolve, reject);
            });
        }

        let stream = this.createReadStream();
        let buf = [];
        let buflen = 0;
        let returned = false;

        stream.on('readable', () => {
            let chunk;

            while ((chunk = stream.read()) !== null) {
                buf.push(chunk);
                buflen += chunk.length;
            }
        });

        stream.once('error', err => {
            if (returned) {
                return;
            }
            returned = true;

            return callback(err);
        });

        stream.once('end', chunk => {
            if (returned) {
                return;
            }
            returned = true;

            if (chunk && chunk.length) {
                buf.push(chunk);
                buflen += chunk.length;
            }
            return callback(null, Buffer.concat(buf, buflen));
        });

        return promise;
    }

    getTransferEncoding() {
        let transferEncoding = false;
        let contentType = (this.getHeader('Content-Type') || '').toString().toLowerCase().trim();

        if (this.content) {
            transferEncoding = (this.getHeader('Content-Transfer-Encoding') || '').toString().toLowerCase().trim();
            if (!transferEncoding || !['base64', 'quoted-printable'].includes(transferEncoding)) {
                if (/^text\//i.test(contentType)) {
                    // If there are no special symbols, no need to modify the text
                    if (this._isPlainText && !this._hasLongLines) {
                        transferEncoding = '7bit';
                    } else if (typeof this.content === 'string' || this.content instanceof Buffer) {
                        // detect preferred encoding for string value
                        transferEncoding = this._getTextEncoding(this.content) === 'Q' ? 'quoted-printable' : 'base64';
                    } else {
                        // we can not check content for a stream, so either use preferred encoding or fallback to QP
                        transferEncoding = this.transferEncoding === 'B' ? 'base64' : 'quoted-printable';
                    }
                } else if (!/^(multipart|message)\//i.test(contentType)) {
                    transferEncoding = transferEncoding || 'base64';
                }
            }
        }
        return transferEncoding;
    }

    /**
     * Builds the header block for the mime node. Append \r\n\r\n before writing the content
     *
     * @returns {String} Headers
     */
    buildHeaders() {
        let transferEncoding = this.getTransferEncoding();
        let headers = [];

        if (transferEncoding) {
            this.setHeader('Content-Transfer-Encoding', transferEncoding);
        }

        if (this.filename && !this.getHeader('Content-Disposition')) {
            this.setHeader('Content-Disposition', 'attachment');
        }

        // Ensure mandatory header fields
        if (this.rootNode === this) {
            if (!this.getHeader('Date')) {
                this.setHeader('Date', this.date.toUTCString().replace(/GMT/, '+0000'));
            }

            // ensure that Message-Id is present
            this.messageId();

            if (!this.getHeader('MIME-Version')) {
                this.setHeader('MIME-Version', '1.0');
            }
        }

        this._headers.forEach(header => {
            let key = header.key;
            let value = header.value;
            let structured;
            let param;
            let options = {};
            let formattedHeaders = ['From', 'Sender', 'To', 'Cc', 'Bcc', 'Reply-To', 'Date', 'References'];

            if (value && typeof value === 'object' && !formattedHeaders.includes(key)) {
                Object.keys(value).forEach(key => {
                    if (key !== 'value') {
                        options[key] = value[key];
                    }
                });
                value = (value.value || '').toString();
                if (!value.trim()) {
                    return;
                }
            }

            if (options.prepared) {
                // header value is
                if (options.foldLines) {
                    headers.push(mimeFuncs.foldLines(key + ': ' + value));
                } else {
                    headers.push(key + ': ' + value);
                }
                return;
            }

            switch (header.key) {
                case 'Content-Disposition':
                    structured = mimeFuncs.parseHeaderValue(value);
                    if (this.filename) {
                        structured.params.filename = this.filename;
                    }
                    value = mimeFuncs.buildHeaderValue(structured);
                    break;
                case 'Content-Type':
                    structured = mimeFuncs.parseHeaderValue(value);

                    this._handleContentType(structured);

                    if (structured.value.match(/^text\/plain\b/) && typeof this.content === 'string' && /[\u0080-\uFFFF]/.test(this.content)) {
                        structured.params.charset = 'utf-8';
                    }

                    value = mimeFuncs.buildHeaderValue(structured);

                    if (this.filename) {
                        // add support for non-compliant clients like QQ webmail
                        // we can't build the value with buildHeaderValue as the value is non standard and
                        // would be converted to parameter continuation encoding that we do not want
                        param = this._encodeWords(this.filename);

                        if (param !== this.filename || /[\s'"\\;:/=(),<>@[\]?]|^-/.test(param)) {
                            // include value in quotes if needed
                            param = '"' + param + '"';
                        }
                        value += '; name=' + param;
                    }
                    break;
                case 'Bcc':
                    if (!this.keepBcc) {
                        // skip BCC values
                        return;
                    }
                    break;
            }

            value = this._encodeHeaderValue(key, value);

            // skip empty lines
            if (!(value || '').toString().trim()) {
                return;
            }

            if (typeof this.normalizeHeaderKey === 'function') {
                let normalized = this.normalizeHeaderKey(key, value);
                if (normalized && typeof normalized === 'string' && normalized.length) {
                    key = normalized;
                }
            }

            headers.push(mimeFuncs.foldLines(key + ': ' + value, 76));
        });

        return headers.join('\r\n');
    }

    /**
     * Streams the rfc2822 message from the current node. If this is a root node,
     * mandatory header fields are set if missing (Date, Message-Id, MIME-Version)
     *
     * @return {String} Compiled message
     */
    createReadStream(options) {
        options = options || {};

        let stream = new PassThrough(options);
        let outputStream = stream;
        let transform;

        this.stream(stream, options, err => {
            if (err) {
                outputStream.emit('error', err);
                return;
            }
            stream.end();
        });

        for (let i = 0, len = this._transforms.length; i < len; i++) {
            transform = typeof this._transforms[i] === 'function' ? this._transforms[i]() : this._transforms[i];
            outputStream.once('error', err => {
                transform.emit('error', err);
            });
            outputStream = outputStream.pipe(transform);
        }

        // ensure terminating newline after possible user transforms
        transform = new LastNewline();
        outputStream.once('error', err => {
            transform.emit('error', err);
        });
        outputStream = outputStream.pipe(transform);

        // dkim and stuff
        for (let i = 0, len = this._processFuncs.length; i < len; i++) {
            transform = this._processFuncs[i];
            outputStream = transform(outputStream);
        }

        return outputStream;
    }

    /**
     * Appends a transform stream object to the transforms list. Final output
     * is passed through this stream before exposing
     *
     * @param {Object} transform Read-Write stream
     */
    transform(transform) {
        this._transforms.push(transform);
    }

    /**
     * Appends a post process function. The functon is run after transforms and
     * uses the following syntax
     *
     *   processFunc(input) -> outputStream
     *
     * @param {Object} processFunc Read-Write stream
     */
    processFunc(processFunc) {
        this._processFuncs.push(processFunc);
    }

    stream(outputStream, options, done) {
        let transferEncoding = this.getTransferEncoding();
        let contentStream;
        let localStream;

        // protect actual callback against multiple triggering
        let returned = false;
        let callback = err => {
            if (returned) {
                return;
            }
            returned = true;
            done(err);
        };

        // for multipart nodes, push child nodes
        // for content nodes end the stream
        let finalize = () => {
            let childId = 0;
            let processChildNode = () => {
                if (childId >= this.childNodes.length) {
                    outputStream.write('\r\n--' + this.boundary + '--\r\n');
                    return callback();
                }
                let child = this.childNodes[childId++];
                outputStream.write((childId > 1 ? '\r\n' : '') + '--' + this.boundary + '\r\n');
                child.stream(outputStream, options, err => {
                    if (err) {
                        return callback(err);
                    }
                    setImmediate(processChildNode);
                });
            };

            if (this.multipart) {
                setImmediate(processChildNode);
            } else {
                return callback();
            }
        };

        // pushes node content
        let sendContent = () => {
            if (this.content) {
                if (Object.prototype.toString.call(this.content) === '[object Error]') {
                    // content is already errored
                    return callback(this.content);
                }

                if (typeof this.content.pipe === 'function') {
                    this.content.removeListener('error', this._contentErrorHandler);
                    this._contentErrorHandler = err => callback(err);
                    this.content.once('error', this._contentErrorHandler);
                }

                let createStream = () => {
                    if (['quoted-printable', 'base64'].includes(transferEncoding)) {
                        contentStream = new (transferEncoding === 'base64' ? base64 : qp).Encoder(options);

                        contentStream.pipe(outputStream, {
                            end: false
                        });
                        contentStream.once('end', finalize);
                        contentStream.once('error', err => callback(err));

                        localStream = this._getStream(this.content);
                        localStream.pipe(contentStream);
                    } else {
                        // anything that is not QP or Base54 passes as-is
                        localStream = this._getStream(this.content);
                        localStream.pipe(outputStream, {
                            end: false
                        });
                        localStream.once('end', finalize);
                    }

                    localStream.once('error', err => callback(err));
                };

                if (this.content._resolve) {
                    let chunks = [];
                    let chunklen = 0;
                    let returned = false;
                    let sourceStream = this._getStream(this.content);
                    sourceStream.on('error', err => {
                        if (returned) {
                            return;
                        }
                        returned = true;
                        callback(err);
                    });
                    sourceStream.on('readable', () => {
                        let chunk;
                        while ((chunk = sourceStream.read()) !== null) {
                            chunks.push(chunk);
                            chunklen += chunk.length;
                        }
                    });
                    sourceStream.on('end', () => {
                        if (returned) {
                            return;
                        }
                        returned = true;
                        this.content._resolve = false;
                        this.content._resolvedValue = Buffer.concat(chunks, chunklen);
                        setImmediate(createStream);
                    });
                } else {
                    setImmediate(createStream);
                }
                return;
            } else {
                return setImmediate(finalize);
            }
        };

        if (this._raw) {
            setImmediate(() => {
                if (Object.prototype.toString.call(this._raw) === '[object Error]') {
                    // content is already errored
                    return callback(this._raw);
                }

                // remove default error handler (if set)
                if (typeof this._raw.pipe === 'function') {
                    this._raw.removeListener('error', this._contentErrorHandler);
                }

                let raw = this._getStream(this._raw);
                raw.pipe(outputStream, {
                    end: false
                });
                raw.on('error', err => outputStream.emit('error', err));
                raw.on('end', finalize);
            });
        } else {
            outputStream.write(this.buildHeaders() + '\r\n\r\n');
            setImmediate(sendContent);
        }
    }

    /**
     * Sets envelope to be used instead of the generated one
     *
     * @return {Object} SMTP envelope in the form of {from: 'from@example.com', to: ['to@example.com']}
     */
    setEnvelope(envelope) {
        let list;

        this._envelope = {
            from: false,
            to: []
        };

        if (envelope.from) {
            list = [];
            this._convertAddresses(this._parseAddresses(envelope.from), list);
            list = list.filter(address => address && address.address);
            if (list.length && list[0]) {
                this._envelope.from = list[0].address;
            }
        }
        ['to', 'cc', 'bcc'].forEach(key => {
            if (envelope[key]) {
                this._convertAddresses(this._parseAddresses(envelope[key]), this._envelope.to);
            }
        });

        this._envelope.to = this._envelope.to.map(to => to.address).filter(address => address);

        let standardFields = ['to', 'cc', 'bcc', 'from'];
        Object.keys(envelope).forEach(key => {
            if (!standardFields.includes(key)) {
                this._envelope[key] = envelope[key];
            }
        });

        return this;
    }

    /**
     * Generates and returns an object with parsed address fields
     *
     * @return {Object} Address object
     */
    getAddresses() {
        let addresses = {};

        this._headers.forEach(header => {
            let key = header.key.toLowerCase();
            if (['from', 'sender', 'reply-to', 'to', 'cc', 'bcc'].includes(key)) {
                if (!Array.isArray(addresses[key])) {
                    addresses[key] = [];
                }

                this._convertAddresses(this._parseAddresses(header.value), addresses[key]);
            }
        });

        return addresses;
    }

    /**
     * Generates and returns SMTP envelope with the sender address and a list of recipients addresses
     *
     * @return {Object} SMTP envelope in the form of {from: 'from@example.com', to: ['to@example.com']}
     */
    getEnvelope() {
        if (this._envelope) {
            return this._envelope;
        }

        let envelope = {
            from: false,
            to: []
        };
        this._headers.forEach(header => {
            let list = [];
            if (header.key === 'From' || (!envelope.from && ['Reply-To', 'Sender'].includes(header.key))) {
                this._convertAddresses(this._parseAddresses(header.value), list);
                if (list.length && list[0]) {
                    envelope.from = list[0].address;
                }
            } else if (['To', 'Cc', 'Bcc'].includes(header.key)) {
                this._convertAddresses(this._parseAddresses(header.value), envelope.to);
            }
        });

        envelope.to = envelope.to.map(to => to.address);

        return envelope;
    }

    /**
     * Returns Message-Id value. If it does not exist, then creates one
     *
     * @return {String} Message-Id value
     */
    messageId() {
        let messageId = this.getHeader('Message-ID');
        // You really should define your own Message-Id field!
        if (!messageId) {
            messageId = this._generateMessageId();
            this.setHeader('Message-ID', messageId);
        }
        return messageId;
    }

    /**
     * Sets pregenerated content that will be used as the output of this node
     *
     * @param {String|Buffer|Stream} Raw MIME contents
     */
    setRaw(raw) {
        this._raw = raw;

        if (this._raw && typeof this._raw.pipe === 'function') {
            // pre-stream handler. might be triggered if a stream is set as content
            // and 'error' fires before anything is done with this stream
            this._contentErrorHandler = err => {
                this._raw.removeListener('error', this._contentErrorHandler);
                this._raw = err;
            };
            this._raw.once('error', this._contentErrorHandler);
        }

        return this;
    }

    /////// PRIVATE METHODS

    /**
     * Detects and returns handle to a stream related with the content.
     *
     * @param {Mixed} content Node content
     * @returns {Object} Stream object
     */
    _getStream(content) {
        let contentStream;

        if (content._resolvedValue) {
            // pass string or buffer content as a stream
            contentStream = new PassThrough();
            setImmediate(() => contentStream.end(content._resolvedValue));
            return contentStream;
        } else if (typeof content.pipe === 'function') {
            // assume as stream
            return content;
        } else if (content && typeof content.path === 'string' && !content.href) {
            if (this.disableFileAccess) {
                contentStream = new PassThrough();
                setImmediate(() => contentStream.emit('error', new Error('File access rejected for ' + content.path)));
                return contentStream;
            }
            // read file
            return fs.createReadStream(content.path);
        } else if (content && typeof content.href === 'string') {
            if (this.disableUrlAccess) {
                contentStream = new PassThrough();
                setImmediate(() => contentStream.emit('error', new Error('Url access rejected for ' + content.href)));
                return contentStream;
            }
            // fetch URL
            return fetch(content.href, { headers: content.httpHeaders });
        } else {
            // pass string or buffer content as a stream
            contentStream = new PassThrough();
            setImmediate(() => contentStream.end(content || ''));
            return contentStream;
        }
    }

    /**
     * Parses addresses. Takes in a single address or an array or an
     * array of address arrays (eg. To: [[first group], [second group],...])
     *
     * @param {Mixed} addresses Addresses to be parsed
     * @return {Array} An array of address objects
     */
    _parseAddresses(addresses) {
        return [].concat.apply(
            [],
            [].concat(addresses).map(address => {
                // eslint-disable-line prefer-spread
                if (address && address.address) {
                    address.address = this._normalizeAddress(address.address);
                    address.name = address.name || '';
                    return [address];
                }
                return addressparser(address);
            })
        );
    }

    /**
     * Normalizes a header key, uses Camel-Case form, except for uppercase MIME-
     *
     * @param {String} key Key to be normalized
     * @return {String} key in Camel-Case form
     */
    _normalizeHeaderKey(key) {
        key = (key || '')
            .toString()
            // no newlines in keys
            .replace(/\r?\n|\r/g, ' ')
            .trim()
            .toLowerCase()
            // use uppercase words, except MIME
            .replace(/^X-SMTPAPI$|^(MIME|DKIM)\b|^[a-z]|-(SPF|FBL|ID|MD5)$|-[a-z]/gi, c => c.toUpperCase())
            // special case
            .replace(/^Content-Features$/i, 'Content-features');

        return key;
    }

    /**
     * Checks if the content type is multipart and defines boundary if needed.
     * Doesn't return anything, modifies object argument instead.
     *
     * @param {Object} structured Parsed header value for 'Content-Type' key
     */
    _handleContentType(structured) {
        this.contentType = structured.value.trim().toLowerCase();

        this.multipart = /^multipart\//i.test(this.contentType) ? this.contentType.substr(this.contentType.indexOf('/') + 1) : false;

        if (this.multipart) {
            this.boundary = structured.params.boundary = structured.params.boundary || this.boundary || this._generateBoundary();
        } else {
            this.boundary = false;
        }
    }

    /**
     * Generates a multipart boundary value
     *
     * @return {String} boundary value
     */
    _generateBoundary() {
        return this.rootNode.boundaryPrefix + '-' + this.rootNode.baseBoundary + '-Part_' + this._nodeId;
    }

    /**
     * Encodes a header value for use in the generated rfc2822 email.
     *
     * @param {String} key Header key
     * @param {String} value Header value
     */
    _encodeHeaderValue(key, value) {
        key = this._normalizeHeaderKey(key);

        switch (key) {
            // Structured headers
            case 'From':
            case 'Sender':
            case 'To':
            case 'Cc':
            case 'Bcc':
            case 'Reply-To':
                return this._convertAddresses(this._parseAddresses(value));

            // values enclosed in <>
            case 'Message-ID':
            case 'In-Reply-To':
            case 'Content-Id':
                value = (value || '').toString().replace(/\r?\n|\r/g, ' ');

                if (value.charAt(0) !== '<') {
                    value = '<' + value;
                }

                if (value.charAt(value.length - 1) !== '>') {
                    value = value + '>';
                }
                return value;

            // space separated list of values enclosed in <>
            case 'References':
                value = [].concat
                    .apply(
                        [],
                        [].concat(value || '').map(elm => {
                            // eslint-disable-line prefer-spread
                            elm = (elm || '')
                                .toString()
                                .replace(/\r?\n|\r/g, ' ')
                                .trim();
                            return elm.replace(/<[^>]*>/g, str => str.replace(/\s/g, '')).split(/\s+/);
                        })
                    )
                    .map(elm => {
                        if (elm.charAt(0) !== '<') {
                            elm = '<' + elm;
                        }
                        if (elm.charAt(elm.length - 1) !== '>') {
                            elm = elm + '>';
                        }
                        return elm;
                    });

                return value.join(' ').trim();

            case 'Date':
                if (Object.prototype.toString.call(value) === '[object Date]') {
                    return value.toUTCString().replace(/GMT/, '+0000');
                }

                value = (value || '').toString().replace(/\r?\n|\r/g, ' ');
                return this._encodeWords(value);

            default:
                value = (value || '').toString().replace(/\r?\n|\r/g, ' ');
                // encodeWords only encodes if needed, otherwise the original string is returned
                return this._encodeWords(value);
        }
    }

    /**
     * Rebuilds address object using punycode and other adjustments
     *
     * @param {Array} addresses An array of address objects
     * @param {Array} [uniqueList] An array to be populated with addresses
     * @return {String} address string
     */
    _convertAddresses(addresses, uniqueList) {
        let values = [];

        uniqueList = uniqueList || [];

        [].concat(addresses || []).forEach(address => {
            if (address.address) {
                address.address = this._normalizeAddress(address.address);

                if (!address.name) {
                    values.push(address.address);
                } else if (address.name) {
                    values.push(this._encodeAddressName(address.name) + ' <' + address.address + '>');
                }

                if (address.address) {
                    if (!uniqueList.filter(a => a.address === address.address).length) {
                        uniqueList.push(address);
                    }
                }
            } else if (address.group) {
                values.push(
                    this._encodeAddressName(address.name) + ':' + (address.group.length ? this._convertAddresses(address.group, uniqueList) : '').trim() + ';'
                );
            }
        });

        return values.join(', ');
    }

    /**
     * Normalizes an email address
     *
     * @param {Array} address An array of address objects
     * @return {String} address string
     */
    _normalizeAddress(address) {
        address = (address || '').toString().trim();

        let lastAt = address.lastIndexOf('@');
        if (lastAt < 0) {
            // Bare username
            return address;
        }
        let user = address.substr(0, lastAt);
        let domain = address.substr(lastAt + 1);

        // Usernames are not touched and are kept as is even if these include unicode
        // Domains are punycoded by default
        // 'j??geva.ee' will be converted to 'xn--jgeva-dua.ee'
        // non-unicode domains are left as is

        return user + '@' + punycode.toASCII(domain.toLowerCase());
    }

    /**
     * If needed, mime encodes the name part
     *
     * @param {String} name Name part of an address
     * @returns {String} Mime word encoded string if needed
     */
    _encodeAddressName(name) {
        if (!/^[\w ']*$/.test(name)) {
            if (/^[\x20-\x7e]*$/.test(name)) {
                return '"' + name.replace(/([\\"])/g, '\\$1') + '"';
            } else {
                return mimeFuncs.encodeWord(name, this._getTextEncoding(name), 52);
            }
        }
        return name;
    }

    /**
     * If needed, mime encodes the name part
     *
     * @param {String} name Name part of an address
     * @returns {String} Mime word encoded string if needed
     */
    _encodeWords(value) {
        // set encodeAll parameter to true even though it is against the recommendation of RFC2047,
        // by default only words that include non-ascii should be converted into encoded words
        // but some clients (eg. Zimbra) do not handle it properly and remove surrounding whitespace
        return mimeFuncs.encodeWords(value, this._getTextEncoding(value), 52, true);
    }

    /**
     * Detects best mime encoding for a text value
     *
     * @param {String} value Value to check for
     * @return {String} either 'Q' or 'B'
     */
    _getTextEncoding(value) {
        value = (value || '').toString();

        let encoding = this.textEncoding;
        let latinLen;
        let nonLatinLen;

        if (!encoding) {
            // count latin alphabet symbols and 8-bit range symbols + control symbols
            // if there are more latin characters, then use quoted-printable
            // encoding, otherwise use base64
            nonLatinLen = (value.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\u0080-\uFFFF]/g) || []).length; // eslint-disable-line no-control-regex
            latinLen = (value.match(/[a-z]/gi) || []).length;
            // if there are more latin symbols than binary/unicode, then prefer Q, otherwise B
            encoding = nonLatinLen < latinLen ? 'Q' : 'B';
        }
        return encoding;
    }

    /**
     * Generates a message id
     *
     * @return {String} Random Message-ID value
     */
    _generateMessageId() {
        return (
            '<' +
            [2, 2, 2, 6].reduce(
                // crux to generate UUID-like random strings
                (prev, len) => prev + '-' + crypto.randomBytes(len).toString('hex'),
                crypto.randomBytes(4).toString('hex')
            ) +
            '@' +
            // try to use the domain of the FROM address or fallback to server hostname
            (this.getEnvelope().from || this.hostname || os.hostname() || 'localhost').split('@').pop() +
            '>'
        );
    }
}

module.exports = MimeNode;


/***/ }),

/***/ 3368:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";


const Transform = __webpack_require__(2413).Transform;

class LastNewline extends Transform {
    constructor() {
        super();
        this.lastByte = false;
    }

    _transform(chunk, encoding, done) {
        if (chunk.length) {
            this.lastByte = chunk[chunk.length - 1];
        }

        this.push(chunk);
        done();
    }

    _flush(done) {
        if (this.lastByte === 0x0a) {
            return done();
        }
        if (this.lastByte === 0x0d) {
            this.push(Buffer.from('\n'));
            return done();
        }
        this.push(Buffer.from('\r\n'));
        return done();
    }
}

module.exports = LastNewline;


/***/ }),

/***/ 4289:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";


const Mailer = __webpack_require__(833);
const shared = __webpack_require__(2673);
const SMTPPool = __webpack_require__(560);
const SMTPTransport = __webpack_require__(3349);
const SendmailTransport = __webpack_require__(8910);
const StreamTransport = __webpack_require__(1888);
const JSONTransport = __webpack_require__(3819);
const SESTransport = __webpack_require__(5924);
const fetch = __webpack_require__(9106);
const packageData = __webpack_require__(7643);

const ETHEREAL_API = (process.env.ETHEREAL_API || 'https://api.nodemailer.com').replace(/\/+$/, '');
const ETHEREAL_WEB = (process.env.ETHEREAL_WEB || 'https://ethereal.email').replace(/\/+$/, '');
const ETHEREAL_CACHE = ['true', 'yes', 'y', '1'].includes(
    (process.env.ETHEREAL_CACHE || 'yes')
        .toString()
        .trim()
        .toLowerCase()
);

let testAccount = false;

module.exports.createTransport = function(transporter, defaults) {
    let urlConfig;
    let options;
    let mailer;

    if (
        // provided transporter is a configuration object, not transporter plugin
        (typeof transporter === 'object' && typeof transporter.send !== 'function') ||
        // provided transporter looks like a connection url
        (typeof transporter === 'string' && /^(smtps?|direct):/i.test(transporter))
    ) {
        if ((urlConfig = typeof transporter === 'string' ? transporter : transporter.url)) {
            // parse a configuration URL into configuration options
            options = shared.parseConnectionUrl(urlConfig);
        } else {
            options = transporter;
        }

        if (options.pool) {
            transporter = new SMTPPool(options);
        } else if (options.sendmail) {
            transporter = new SendmailTransport(options);
        } else if (options.streamTransport) {
            transporter = new StreamTransport(options);
        } else if (options.jsonTransport) {
            transporter = new JSONTransport(options);
        } else if (options.SES) {
            transporter = new SESTransport(options);
        } else {
            transporter = new SMTPTransport(options);
        }
    }

    mailer = new Mailer(transporter, options, defaults);

    return mailer;
};

module.exports.createTestAccount = function(apiUrl, callback) {
    let promise;

    if (!callback && typeof apiUrl === 'function') {
        callback = apiUrl;
        apiUrl = false;
    }

    if (!callback) {
        promise = new Promise((resolve, reject) => {
            callback = shared.callbackPromise(resolve, reject);
        });
    }

    if (ETHEREAL_CACHE && testAccount) {
        setImmediate(() => callback(null, testAccount));
        return promise;
    }

    apiUrl = apiUrl || ETHEREAL_API;

    let chunks = [];
    let chunklen = 0;

    let req = fetch(apiUrl + '/user', {
        contentType: 'application/json',
        method: 'POST',
        body: Buffer.from(
            JSON.stringify({
                requestor: packageData.name,
                version: packageData.version
            })
        )
    });

    req.on('readable', () => {
        let chunk;
        while ((chunk = req.read()) !== null) {
            chunks.push(chunk);
            chunklen += chunk.length;
        }
    });

    req.once('error', err => callback(err));

    req.once('end', () => {
        let res = Buffer.concat(chunks, chunklen);
        let data;
        let err;
        try {
            data = JSON.parse(res.toString());
        } catch (E) {
            err = E;
        }
        if (err) {
            return callback(err);
        }
        if (data.status !== 'success' || data.error) {
            return callback(new Error(data.error || 'Request failed'));
        }
        delete data.status;
        testAccount = data;
        callback(null, testAccount);
    });

    return promise;
};

module.exports.getTestMessageUrl = function(info) {
    if (!info || !info.response) {
        return false;
    }

    let infoProps = new Map();
    info.response.replace(/\[([^\]]+)\]$/, (m, props) => {
        props.replace(/\b([A-Z0-9]+)=([^\s]+)/g, (m, key, value) => {
            infoProps.set(key, value);
        });
    });

    if (infoProps.has('STATUS') && infoProps.has('MSGID')) {
        return (testAccount.web || ETHEREAL_WEB) + '/message/' + infoProps.get('MSGID');
    }

    return false;
};


/***/ }),

/***/ 9716:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";


const Transform = __webpack_require__(2413).Transform;

/**
 * Encodes a Buffer into a Quoted-Printable encoded string
 *
 * @param {Buffer} buffer Buffer to convert
 * @returns {String} Quoted-Printable encoded string
 */
function encode(buffer) {
    if (typeof buffer === 'string') {
        buffer = Buffer.from(buffer, 'utf-8');
    }

    // usable characters that do not need encoding
    let ranges = [
        // https://tools.ietf.org/html/rfc2045#section-6.7
        [0x09], // <TAB>
        [0x0a], // <LF>
        [0x0d], // <CR>
        [0x20, 0x3c], // <SP>!"#$%&'()*+,-./0123456789:;
        [0x3e, 0x7e] // >?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijklmnopqrstuvwxyz{|}
    ];
    let result = '';
    let ord;

    for (let i = 0, len = buffer.length; i < len; i++) {
        ord = buffer[i];
        // if the char is in allowed range, then keep as is, unless it is a WS in the end of a line
        if (checkRanges(ord, ranges) && !((ord === 0x20 || ord === 0x09) && (i === len - 1 || buffer[i + 1] === 0x0a || buffer[i + 1] === 0x0d))) {
            result += String.fromCharCode(ord);
            continue;
        }
        result += '=' + (ord < 0x10 ? '0' : '') + ord.toString(16).toUpperCase();
    }

    return result;
}

/**
 * Adds soft line breaks to a Quoted-Printable string
 *
 * @param {String} str Quoted-Printable encoded string that might need line wrapping
 * @param {Number} [lineLength=76] Maximum allowed length for a line
 * @returns {String} Soft-wrapped Quoted-Printable encoded string
 */
function wrap(str, lineLength) {
    str = (str || '').toString();
    lineLength = lineLength || 76;

    if (str.length <= lineLength) {
        return str;
    }

    let pos = 0;
    let len = str.length;
    let match, code, line;
    let lineMargin = Math.floor(lineLength / 3);
    let result = '';

    // insert soft linebreaks where needed
    while (pos < len) {
        line = str.substr(pos, lineLength);
        if ((match = line.match(/\r\n/))) {
            line = line.substr(0, match.index + match[0].length);
            result += line;
            pos += line.length;
            continue;
        }

        if (line.substr(-1) === '\n') {
            // nothing to change here
            result += line;
            pos += line.length;
            continue;
        } else if ((match = line.substr(-lineMargin).match(/\n.*?$/))) {
            // truncate to nearest line break
            line = line.substr(0, line.length - (match[0].length - 1));
            result += line;
            pos += line.length;
            continue;
        } else if (line.length > lineLength - lineMargin && (match = line.substr(-lineMargin).match(/[ \t.,!?][^ \t.,!?]*$/))) {
            // truncate to nearest space
            line = line.substr(0, line.length - (match[0].length - 1));
        } else if (line.match(/[=][\da-f]{0,2}$/i)) {
            // push incomplete encoding sequences to the next line
            if ((match = line.match(/[=][\da-f]{0,1}$/i))) {
                line = line.substr(0, line.length - match[0].length);
            }

            // ensure that utf-8 sequences are not split
            while (line.length > 3 && line.length < len - pos && !line.match(/^(?:=[\da-f]{2}){1,4}$/i) && (match = line.match(/[=][\da-f]{2}$/gi))) {
                code = parseInt(match[0].substr(1, 2), 16);
                if (code < 128) {
                    break;
                }

                line = line.substr(0, line.length - 3);

                if (code >= 0xc0) {
                    break;
                }
            }
        }

        if (pos + line.length < len && line.substr(-1) !== '\n') {
            if (line.length === lineLength && line.match(/[=][\da-f]{2}$/i)) {
                line = line.substr(0, line.length - 3);
            } else if (line.length === lineLength) {
                line = line.substr(0, line.length - 1);
            }
            pos += line.length;
            line += '=\r\n';
        } else {
            pos += line.length;
        }

        result += line;
    }

    return result;
}

/**
 * Helper function to check if a number is inside provided ranges
 *
 * @param {Number} nr Number to check for
 * @param {Array} ranges An Array of allowed values
 * @returns {Boolean} True if the value was found inside allowed ranges, false otherwise
 */
function checkRanges(nr, ranges) {
    for (let i = ranges.length - 1; i >= 0; i--) {
        if (!ranges[i].length) {
            continue;
        }
        if (ranges[i].length === 1 && nr === ranges[i][0]) {
            return true;
        }
        if (ranges[i].length === 2 && nr >= ranges[i][0] && nr <= ranges[i][1]) {
            return true;
        }
    }
    return false;
}

/**
 * Creates a transform stream for encoding data to Quoted-Printable encoding
 *
 * @constructor
 * @param {Object} options Stream options
 * @param {Number} [options.lineLength=76] Maximum lenght for lines, set to false to disable wrapping
 */
class Encoder extends Transform {
    constructor(options) {
        super();

        // init Transform
        this.options = options || {};

        if (this.options.lineLength !== false) {
            this.options.lineLength = this.options.lineLength || 76;
        }

        this._curLine = '';

        this.inputBytes = 0;
        this.outputBytes = 0;
    }

    _transform(chunk, encoding, done) {
        let qp;

        if (encoding !== 'buffer') {
            chunk = Buffer.from(chunk, encoding);
        }

        if (!chunk || !chunk.length) {
            return done();
        }

        this.inputBytes += chunk.length;

        if (this.options.lineLength) {
            qp = this._curLine + encode(chunk);
            qp = wrap(qp, this.options.lineLength);
            qp = qp.replace(/(^|\n)([^\n]*)$/, (match, lineBreak, lastLine) => {
                this._curLine = lastLine;
                return lineBreak;
            });

            if (qp) {
                this.outputBytes += qp.length;
                this.push(qp);
            }
        } else {
            qp = encode(chunk);
            this.outputBytes += qp.length;
            this.push(qp, 'ascii');
        }

        done();
    }

    _flush(done) {
        if (this._curLine) {
            this.outputBytes += this._curLine.length;
            this.push(this._curLine, 'ascii');
        }
        done();
    }
}

// expose to the world
module.exports = {
    encode,
    wrap,
    Encoder
};


/***/ }),

/***/ 8910:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";


const spawn = __webpack_require__(3129).spawn;
const packageData = __webpack_require__(7643);
const LeWindows = __webpack_require__(741);
const LeUnix = __webpack_require__(7754);
const shared = __webpack_require__(2673);

/**
 * Generates a Transport object for Sendmail
 *
 * Possible options can be the following:
 *
 *  * **path** optional path to sendmail binary
 *  * **newline** either 'windows' or 'unix'
 *  * **args** an array of arguments for the sendmail binary
 *
 * @constructor
 * @param {Object} optional config parameter for Sendmail
 */
class SendmailTransport {
    constructor(options) {
        options = options || {};

        // use a reference to spawn for mocking purposes
        this._spawn = spawn;

        this.options = options || {};

        this.name = 'Sendmail';
        this.version = packageData.version;

        this.path = 'sendmail';
        this.args = false;
        this.winbreak = false;

        this.logger = shared.getLogger(this.options, {
            component: this.options.component || 'sendmail'
        });

        if (options) {
            if (typeof options === 'string') {
                this.path = options;
            } else if (typeof options === 'object') {
                if (options.path) {
                    this.path = options.path;
                }
                if (Array.isArray(options.args)) {
                    this.args = options.args;
                }
                this.winbreak = ['win', 'windows', 'dos', '\r\n'].includes((options.newline || '').toString().toLowerCase());
            }
        }
    }

    /**
     * <p>Compiles a mailcomposer message and forwards it to handler that sends it.</p>
     *
     * @param {Object} emailMessage MailComposer object
     * @param {Function} callback Callback function to run when the sending is completed
     */
    send(mail, done) {
        // Sendmail strips this header line by itself
        mail.message.keepBcc = true;

        let envelope = mail.data.envelope || mail.message.getEnvelope();
        let messageId = mail.message.messageId();
        let args;
        let sendmail;
        let returned;
        let transform;

        if (this.args) {
            // force -i to keep single dots
            args = ['-i'].concat(this.args).concat(envelope.to);
        } else {
            args = ['-i'].concat(envelope.from ? ['-f', envelope.from] : []).concat(envelope.to);
        }

        let callback = err => {
            if (returned) {
                // ignore any additional responses, already done
                return;
            }
            returned = true;
            if (typeof done === 'function') {
                if (err) {
                    return done(err);
                } else {
                    return done(null, {
                        envelope: mail.data.envelope || mail.message.getEnvelope(),
                        messageId,
                        response: 'Messages queued for delivery'
                    });
                }
            }
        };

        try {
            sendmail = this._spawn(this.path, args);
        } catch (E) {
            this.logger.error(
                {
                    err: E,
                    tnx: 'spawn',
                    messageId
                },
                'Error occurred while spawning sendmail. %s',
                E.message
            );
            return callback(E);
        }

        if (sendmail) {
            sendmail.on('error', err => {
                this.logger.error(
                    {
                        err,
                        tnx: 'spawn',
                        messageId
                    },
                    'Error occurred when sending message %s. %s',
                    messageId,
                    err.message
                );
                callback(err);
            });

            sendmail.once('exit', code => {
                if (!code) {
                    return callback();
                }
                let err;
                if (code === 127) {
                    err = new Error('Sendmail command not found, process exited with code ' + code);
                } else {
                    err = new Error('Sendmail exited with code ' + code);
                }

                this.logger.error(
                    {
                        err,
                        tnx: 'stdin',
                        messageId
                    },
                    'Error sending message %s to sendmail. %s',
                    messageId,
                    err.message
                );
                callback(err);
            });
            sendmail.once('close', callback);

            sendmail.stdin.on('error', err => {
                this.logger.error(
                    {
                        err,
                        tnx: 'stdin',
                        messageId
                    },
                    'Error occurred when piping message %s to sendmail. %s',
                    messageId,
                    err.message
                );
                callback(err);
            });

            let recipients = [].concat(envelope.to || []);
            if (recipients.length > 3) {
                recipients.push('...and ' + recipients.splice(2).length + ' more');
            }
            this.logger.info(
                {
                    tnx: 'send',
                    messageId
                },
                'Sending message %s to <%s>',
                messageId,
                recipients.join(', ')
            );

            transform = this.winbreak ? new LeWindows() : new LeUnix();
            let sourceStream = mail.message.createReadStream();

            transform.once('error', err => {
                this.logger.error(
                    {
                        err,
                        tnx: 'stdin',
                        messageId
                    },
                    'Error occurred when generating message %s. %s',
                    messageId,
                    err.message
                );
                sendmail.kill('SIGINT'); // do not deliver the message
                callback(err);
            });

            sourceStream.once('error', err => transform.emit('error', err));
            sourceStream.pipe(transform).pipe(sendmail.stdin);
        } else {
            return callback(new Error('sendmail was not found'));
        }
    }
}

module.exports = SendmailTransport;


/***/ }),

/***/ 7754:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";


const stream = __webpack_require__(2413);
const Transform = stream.Transform;

/**
 * Ensures that only <LF> is used for linebreaks
 *
 * @param {Object} options Stream options
 */
class LeWindows extends Transform {
    constructor(options) {
        super(options);
        // init Transform
        this.options = options || {};
    }

    /**
     * Escapes dots
     */
    _transform(chunk, encoding, done) {
        let buf;
        let lastPos = 0;

        for (let i = 0, len = chunk.length; i < len; i++) {
            if (chunk[i] === 0x0d) {
                // \n
                buf = chunk.slice(lastPos, i);
                lastPos = i + 1;
                this.push(buf);
            }
        }
        if (lastPos && lastPos < chunk.length) {
            buf = chunk.slice(lastPos);
            this.push(buf);
        } else if (!lastPos) {
            this.push(chunk);
        }
        done();
    }
}

module.exports = LeWindows;


/***/ }),

/***/ 741:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";


const stream = __webpack_require__(2413);
const Transform = stream.Transform;

/**
 * Ensures that only <CR><LF> sequences are used for linebreaks
 *
 * @param {Object} options Stream options
 */
class LeWindows extends Transform {
    constructor(options) {
        super(options);
        // init Transform
        this.options = options || {};
        this.lastByte = false;
    }

    /**
     * Escapes dots
     */
    _transform(chunk, encoding, done) {
        let buf;
        let lastPos = 0;

        for (let i = 0, len = chunk.length; i < len; i++) {
            if (chunk[i] === 0x0a) {
                // \n
                if ((i && chunk[i - 1] !== 0x0d) || (!i && this.lastByte !== 0x0d)) {
                    if (i > lastPos) {
                        buf = chunk.slice(lastPos, i);
                        this.push(buf);
                    }
                    this.push(Buffer.from('\r\n'));
                    lastPos = i + 1;
                }
            }
        }

        if (lastPos && lastPos < chunk.length) {
            buf = chunk.slice(lastPos);
            this.push(buf);
        } else if (!lastPos) {
            this.push(chunk);
        }

        this.lastByte = chunk[chunk.length - 1];
        done();
    }
}

module.exports = LeWindows;


/***/ }),

/***/ 5924:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";


const EventEmitter = __webpack_require__(8614);
const packageData = __webpack_require__(7643);
const shared = __webpack_require__(2673);
const LeWindows = __webpack_require__(741);

/**
 * Generates a Transport object for AWS SES
 *
 * Possible options can be the following:
 *
 *  * **sendingRate** optional Number specifying how many messages per second should be delivered to SES
 *  * **maxConnections** optional Number specifying max number of parallel connections to SES
 *
 * @constructor
 * @param {Object} optional config parameter
 */
class SESTransport extends EventEmitter {
    constructor(options) {
        super();
        options = options || {};

        this.options = options || {};
        this.ses = this.options.SES;

        this.name = 'SESTransport';
        this.version = packageData.version;

        this.logger = shared.getLogger(this.options, {
            component: this.options.component || 'ses-transport'
        });

        // parallel sending connections
        this.maxConnections = Number(this.options.maxConnections) || Infinity;
        this.connections = 0;

        // max messages per second
        this.sendingRate = Number(this.options.sendingRate) || Infinity;
        this.sendingRateTTL = null;
        this.rateInterval = 1000;
        this.rateMessages = [];

        this.pending = [];

        this.idling = true;

        setImmediate(() => {
            if (this.idling) {
                this.emit('idle');
            }
        });
    }

    /**
     * Schedules a sending of a message
     *
     * @param {Object} emailMessage MailComposer object
     * @param {Function} callback Callback function to run when the sending is completed
     */
    send(mail, callback) {
        if (this.connections >= this.maxConnections) {
            this.idling = false;
            return this.pending.push({
                mail,
                callback
            });
        }

        if (!this._checkSendingRate()) {
            this.idling = false;
            return this.pending.push({
                mail,
                callback
            });
        }

        this._send(mail, (...args) => {
            setImmediate(() => callback(...args));
            this._sent();
        });
    }

    _checkRatedQueue() {
        if (this.connections >= this.maxConnections || !this._checkSendingRate()) {
            return;
        }

        if (!this.pending.length) {
            if (!this.idling) {
                this.idling = true;
                this.emit('idle');
            }
            return;
        }

        let next = this.pending.shift();
        this._send(next.mail, (...args) => {
            setImmediate(() => next.callback(...args));
            this._sent();
        });
    }

    _checkSendingRate() {
        clearTimeout(this.sendingRateTTL);

        let now = Date.now();
        let oldest = false;
        // delete older messages
        for (let i = this.rateMessages.length - 1; i >= 0; i--) {
            if (this.rateMessages[i].ts >= now - this.rateInterval && (!oldest || this.rateMessages[i].ts < oldest)) {
                oldest = this.rateMessages[i].ts;
            }

            if (this.rateMessages[i].ts < now - this.rateInterval && !this.rateMessages[i].pending) {
                this.rateMessages.splice(i, 1);
            }
        }

        if (this.rateMessages.length < this.sendingRate) {
            return true;
        }

        let delay = Math.max(oldest + 1001, now + 20);
        this.sendingRateTTL = setTimeout(() => this._checkRatedQueue(), now - delay);

        try {
            this.sendingRateTTL.unref();
        } catch (E) {
            // Ignore. Happens on envs with non-node timer implementation
        }

        return false;
    }

    _sent() {
        this.connections--;
        this._checkRatedQueue();
    }

    /**
     * Returns true if there are free slots in the queue
     */
    isIdle() {
        return this.idling;
    }

    /**
     * Compiles a mailcomposer message and forwards it to SES
     *
     * @param {Object} emailMessage MailComposer object
     * @param {Function} callback Callback function to run when the sending is completed
     */
    _send(mail, callback) {
        let statObject = {
            ts: Date.now(),
            pending: true
        };
        this.connections++;
        this.rateMessages.push(statObject);

        let envelope = mail.data.envelope || mail.message.getEnvelope();
        let messageId = mail.message.messageId();

        let recipients = [].concat(envelope.to || []);
        if (recipients.length > 3) {
            recipients.push('...and ' + recipients.splice(2).length + ' more');
        }
        this.logger.info(
            {
                tnx: 'send',
                messageId
            },
            'Sending message %s to <%s>',
            messageId,
            recipients.join(', ')
        );

        let getRawMessage = next => {
            // do not use Message-ID and Date in DKIM signature
            if (!mail.data._dkim) {
                mail.data._dkim = {};
            }
            if (mail.data._dkim.skipFields && typeof mail.data._dkim.skipFields === 'string') {
                mail.data._dkim.skipFields += ':date:message-id';
            } else {
                mail.data._dkim.skipFields = 'date:message-id';
            }

            let sourceStream = mail.message.createReadStream();
            let stream = sourceStream.pipe(new LeWindows());
            let chunks = [];
            let chunklen = 0;

            stream.on('readable', () => {
                let chunk;
                while ((chunk = stream.read()) !== null) {
                    chunks.push(chunk);
                    chunklen += chunk.length;
                }
            });

            sourceStream.once('error', err => stream.emit('error', err));

            stream.once('error', err => {
                next(err);
            });

            stream.once('end', () => next(null, Buffer.concat(chunks, chunklen)));
        };

        setImmediate(() =>
            getRawMessage((err, raw) => {
                if (err) {
                    this.logger.error(
                        {
                            err,
                            tnx: 'send',
                            messageId
                        },
                        'Failed creating message for %s. %s',
                        messageId,
                        err.message
                    );
                    statObject.pending = false;
                    return callback(err);
                }

                let sesMessage = {
                    RawMessage: {
                        // required
                        Data: raw // required
                    },
                    Source: envelope.from,
                    Destinations: envelope.to
                };

                Object.keys(mail.data.ses || {}).forEach(key => {
                    sesMessage[key] = mail.data.ses[key];
                });

                this.ses.sendRawEmail(sesMessage, (err, data) => {
                    if (err) {
                        this.logger.error(
                            {
                                err,
                                tnx: 'send'
                            },
                            'Send error for %s: %s',
                            messageId,
                            err.message
                        );
                        statObject.pending = false;
                        return callback(err);
                    }

                    let region = (this.ses.config && this.ses.config.region) || 'us-east-1';
                    if (region === 'us-east-1') {
                        region = 'email';
                    }

                    statObject.pending = false;
                    callback(null, {
                        envelope: {
                            from: envelope.from,
                            to: envelope.to
                        },
                        messageId: '<' + data.MessageId + (!/@/.test(data.MessageId) ? '@' + region + '.amazonses.com' : '') + '>',
                        response: data.MessageId,
                        raw
                    });
                });
            })
        );
    }

    /**
     * Verifies SES configuration
     *
     * @param {Function} callback Callback function
     */
    verify(callback) {
        let promise;

        if (!callback) {
            promise = new Promise((resolve, reject) => {
                callback = shared.callbackPromise(resolve, reject);
            });
        }

        this.ses.sendRawEmail(
            {
                RawMessage: {
                    // required
                    Data: 'From: invalid@invalid\r\nTo: invalid@invalid\r\n Subject: Invalid\r\n\r\nInvalid'
                },
                Source: 'invalid@invalid',
                Destinations: ['invalid@invalid']
            },
            err => {
                if (err && err.code !== 'InvalidParameterValue') {
                    return callback(err);
                }
                return callback(null, true);
            }
        );

        return promise;
    }
}

module.exports = SESTransport;


/***/ }),

/***/ 2673:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";
/* eslint no-console: 0 */



const urllib = __webpack_require__(8835);
const util = __webpack_require__(1669);
const fs = __webpack_require__(5747);
const fetch = __webpack_require__(9106);
const dns = __webpack_require__(881);
const net = __webpack_require__(1631);

const DNS_TTL = 5 * 60 * 1000;

const resolver = (family, hostname, callback) => {
    dns['resolve' + family](hostname, (err, addresses) => {
        if (err) {
            switch (err.code) {
                case dns.NODATA:
                case dns.NOTFOUND:
                case dns.NOTIMP:
                case dns.SERVFAIL:
                case dns.CONNREFUSED:
                case 'EAI_AGAIN':
                    return callback(null, []);
            }
            return callback(err);
        }
        return callback(null, Array.isArray(addresses) ? addresses : [].concat(addresses || []));
    });
};

const dnsCache = (module.exports.dnsCache = new Map());
module.exports.resolveHostname = (options, callback) => {
    options = options || {};

    if (!options.host || net.isIP(options.host)) {
        // nothing to do here
        let value = {
            host: options.host,
            servername: options.servername || false
        };
        return callback(null, value);
    }

    let cached;

    if (dnsCache.has(options.host)) {
        cached = dnsCache.get(options.host);
        if (!cached.expires || cached.expires >= Date.now()) {
            return callback(null, {
                host: cached.value.host,
                servername: cached.value.servername,
                _cached: true
            });
        }
    }

    resolver(4, options.host, (err, addresses) => {
        if (err) {
            if (cached) {
                // ignore error, use expired value
                return callback(null, cached.value);
            }
            return callback(err);
        }
        if (addresses && addresses.length) {
            let value = {
                host: addresses[0] || options.host,
                servername: options.servername || options.host
            };
            dnsCache.set(options.host, {
                value,
                expires: Date.now() + DNS_TTL
            });
            return callback(null, value);
        }

        resolver(6, options.host, (err, addresses) => {
            if (err) {
                if (cached) {
                    // ignore error, use expired value
                    return callback(null, cached.value);
                }
                return callback(err);
            }
            if (addresses && addresses.length) {
                let value = {
                    host: addresses[0] || options.host,
                    servername: options.servername || options.host
                };
                dnsCache.set(options.host, {
                    value,
                    expires: Date.now() + DNS_TTL
                });
                return callback(null, value);
            }

            try {
                dns.lookup(options.host, {}, (err, address) => {
                    if (err) {
                        if (cached) {
                            // ignore error, use expired value
                            return callback(null, cached.value);
                        }
                        return callback(err);
                    }

                    if (!address && cached) {
                        // nothing was found, fallback to cached value
                        return callback(null, cached.value);
                    }

                    let value = {
                        host: address || options.host,
                        servername: options.servername || options.host
                    };
                    dnsCache.set(options.host, {
                        value,
                        expires: Date.now() + DNS_TTL
                    });
                    return callback(null, value);
                });
            } catch (err) {
                if (cached) {
                    // ignore error, use expired value
                    return callback(null, cached.value);
                }
                return callback(err);
            }
        });
    });
};
/**
 * Parses connection url to a structured configuration object
 *
 * @param {String} str Connection url
 * @return {Object} Configuration object
 */
module.exports.parseConnectionUrl = str => {
    str = str || '';
    let options = {};

    [urllib.parse(str, true)].forEach(url => {
        let auth;

        switch (url.protocol) {
            case 'smtp:':
                options.secure = false;
                break;
            case 'smtps:':
                options.secure = true;
                break;
            case 'direct:':
                options.direct = true;
                break;
        }

        if (!isNaN(url.port) && Number(url.port)) {
            options.port = Number(url.port);
        }

        if (url.hostname) {
            options.host = url.hostname;
        }

        if (url.auth) {
            auth = url.auth.split(':');

            if (!options.auth) {
                options.auth = {};
            }

            options.auth.user = auth.shift();
            options.auth.pass = auth.join(':');
        }

        Object.keys(url.query || {}).forEach(key => {
            let obj = options;
            let lKey = key;
            let value = url.query[key];

            if (!isNaN(value)) {
                value = Number(value);
            }

            switch (value) {
                case 'true':
                    value = true;
                    break;
                case 'false':
                    value = false;
                    break;
            }

            // tls is nested object
            if (key.indexOf('tls.') === 0) {
                lKey = key.substr(4);
                if (!options.tls) {
                    options.tls = {};
                }
                obj = options.tls;
            } else if (key.indexOf('.') >= 0) {
                // ignore nested properties besides tls
                return;
            }

            if (!(lKey in obj)) {
                obj[lKey] = value;
            }
        });
    });

    return options;
};

module.exports._logFunc = (logger, level, defaults, data, message, ...args) => {
    let entry = {};

    Object.keys(defaults || {}).forEach(key => {
        if (key !== 'level') {
            entry[key] = defaults[key];
        }
    });

    Object.keys(data || {}).forEach(key => {
        if (key !== 'level') {
            entry[key] = data[key];
        }
    });

    logger[level](entry, message, ...args);
};

/**
 * Returns a bunyan-compatible logger interface. Uses either provided logger or
 * creates a default console logger
 *
 * @param {Object} [options] Options object that might include 'logger' value
 * @return {Object} bunyan compatible logger
 */
module.exports.getLogger = (options, defaults) => {
    options = options || {};

    let response = {};
    let levels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

    if (!options.logger) {
        // use vanity logger
        levels.forEach(level => {
            response[level] = () => false;
        });
        return response;
    }

    let logger = options.logger;

    if (options.logger === true) {
        // create console logger
        logger = createDefaultLogger(levels);
    }

    levels.forEach(level => {
        response[level] = (data, message, ...args) => {
            module.exports._logFunc(logger, level, defaults, data, message, ...args);
        };
    });

    return response;
};

/**
 * Wrapper for creating a callback that either resolves or rejects a promise
 * based on input
 *
 * @param {Function} resolve Function to run if callback is called
 * @param {Function} reject Function to run if callback ends with an error
 */
module.exports.callbackPromise = (resolve, reject) =>
    function() {
        let args = Array.from(arguments);
        let err = args.shift();
        if (err) {
            reject(err);
        } else {
            resolve(...args);
        }
    };

/**
 * Resolves a String or a Buffer value for content value. Useful if the value
 * is a Stream or a file or an URL. If the value is a Stream, overwrites
 * the stream object with the resolved value (you can't stream a value twice).
 *
 * This is useful when you want to create a plugin that needs a content value,
 * for example the `html` or `text` value as a String or a Buffer but not as
 * a file path or an URL.
 *
 * @param {Object} data An object or an Array you want to resolve an element for
 * @param {String|Number} key Property name or an Array index
 * @param {Function} callback Callback function with (err, value)
 */
module.exports.resolveContent = (data, key, callback) => {
    let promise;

    if (!callback) {
        promise = new Promise((resolve, reject) => {
            callback = module.exports.callbackPromise(resolve, reject);
        });
    }

    let content = (data && data[key] && data[key].content) || data[key];
    let contentStream;
    let encoding = ((typeof data[key] === 'object' && data[key].encoding) || 'utf8')
        .toString()
        .toLowerCase()
        .replace(/[-_\s]/g, '');

    if (!content) {
        return callback(null, content);
    }

    if (typeof content === 'object') {
        if (typeof content.pipe === 'function') {
            return resolveStream(content, (err, value) => {
                if (err) {
                    return callback(err);
                }
                // we can't stream twice the same content, so we need
                // to replace the stream object with the streaming result
                data[key] = value;
                callback(null, value);
            });
        } else if (/^https?:\/\//i.test(content.path || content.href)) {
            contentStream = fetch(content.path || content.href);
            return resolveStream(contentStream, callback);
        } else if (/^data:/i.test(content.path || content.href)) {
            let parts = (content.path || content.href).match(/^data:((?:[^;]*;)*(?:[^,]*)),(.*)$/i);
            if (!parts) {
                return callback(null, Buffer.from(0));
            }
            return callback(null, /\bbase64$/i.test(parts[1]) ? Buffer.from(parts[2], 'base64') : Buffer.from(decodeURIComponent(parts[2])));
        } else if (content.path) {
            return resolveStream(fs.createReadStream(content.path), callback);
        }
    }

    if (typeof data[key].content === 'string' && !['utf8', 'usascii', 'ascii'].includes(encoding)) {
        content = Buffer.from(data[key].content, encoding);
    }

    // default action, return as is
    setImmediate(() => callback(null, content));

    return promise;
};

/**
 * Copies properties from source objects to target objects
 */
module.exports.assign = function(/* target, ... sources */) {
    let args = Array.from(arguments);
    let target = args.shift() || {};

    args.forEach(source => {
        Object.keys(source || {}).forEach(key => {
            if (['tls', 'auth'].includes(key) && source[key] && typeof source[key] === 'object') {
                // tls and auth are special keys that need to be enumerated separately
                // other objects are passed as is
                if (!target[key]) {
                    // ensure that target has this key
                    target[key] = {};
                }
                Object.keys(source[key]).forEach(subKey => {
                    target[key][subKey] = source[key][subKey];
                });
            } else {
                target[key] = source[key];
            }
        });
    });
    return target;
};

module.exports.encodeXText = str => {
    // ! 0x21
    // + 0x2B
    // = 0x3D
    // ~ 0x7E
    if (!/[^\x21-\x2A\x2C-\x3C\x3E-\x7E]/.test(str)) {
        return str;
    }
    let buf = Buffer.from(str);
    let result = '';
    for (let i = 0, len = buf.length; i < len; i++) {
        let c = buf[i];
        if (c < 0x21 || c > 0x7e || c === 0x2b || c === 0x3d) {
            result += '+' + (c < 0x10 ? '0' : '') + c.toString(16).toUpperCase();
        } else {
            result += String.fromCharCode(c);
        }
    }
    return result;
};

/**
 * Streams a stream value into a Buffer
 *
 * @param {Object} stream Readable stream
 * @param {Function} callback Callback function with (err, value)
 */
function resolveStream(stream, callback) {
    let responded = false;
    let chunks = [];
    let chunklen = 0;

    stream.on('error', err => {
        if (responded) {
            return;
        }

        responded = true;
        callback(err);
    });

    stream.on('readable', () => {
        let chunk;
        while ((chunk = stream.read()) !== null) {
            chunks.push(chunk);
            chunklen += chunk.length;
        }
    });

    stream.on('end', () => {
        if (responded) {
            return;
        }
        responded = true;

        let value;

        try {
            value = Buffer.concat(chunks, chunklen);
        } catch (E) {
            return callback(E);
        }
        callback(null, value);
    });
}

/**
 * Generates a bunyan-like logger that prints to console
 *
 * @returns {Object} Bunyan logger instance
 */
function createDefaultLogger(levels) {
    let levelMaxLen = 0;
    let levelNames = new Map();
    levels.forEach(level => {
        if (level.length > levelMaxLen) {
            levelMaxLen = level.length;
        }
    });

    levels.forEach(level => {
        let levelName = level.toUpperCase();
        if (levelName.length < levelMaxLen) {
            levelName += ' '.repeat(levelMaxLen - levelName.length);
        }
        levelNames.set(level, levelName);
    });

    let print = (level, entry, message, ...args) => {
        let prefix = '';
        if (entry) {
            if (entry.tnx === 'server') {
                prefix = 'S: ';
            } else if (entry.tnx === 'client') {
                prefix = 'C: ';
            }

            if (entry.sid) {
                prefix = '[' + entry.sid + '] ' + prefix;
            }

            if (entry.cid) {
                prefix = '[#' + entry.cid + '] ' + prefix;
            }
        }

        message = util.format(message, ...args);
        message.split(/\r?\n/).forEach(line => {
            console.log(
                '[%s] %s %s',
                new Date()
                    .toISOString()
                    .substr(0, 19)
                    .replace(/T/, ' '),
                levelNames.get(level),
                prefix + line
            );
        });
    };

    let logger = {};
    levels.forEach(level => {
        logger[level] = print.bind(null, level);
    });

    return logger;
}


/***/ }),

/***/ 4447:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";


const stream = __webpack_require__(2413);
const Transform = stream.Transform;

/**
 * Escapes dots in the beginning of lines. Ends the stream with <CR><LF>.<CR><LF>
 * Also makes sure that only <CR><LF> sequences are used for linebreaks
 *
 * @param {Object} options Stream options
 */
class DataStream extends Transform {
    constructor(options) {
        super(options);
        // init Transform
        this.options = options || {};
        this._curLine = '';

        this.inByteCount = 0;
        this.outByteCount = 0;
        this.lastByte = false;
    }

    /**
     * Escapes dots
     */
    _transform(chunk, encoding, done) {
        let chunks = [];
        let chunklen = 0;
        let i,
            len,
            lastPos = 0;
        let buf;

        if (!chunk || !chunk.length) {
            return done();
        }

        if (typeof chunk === 'string') {
            chunk = Buffer.from(chunk);
        }

        this.inByteCount += chunk.length;

        for (i = 0, len = chunk.length; i < len; i++) {
            if (chunk[i] === 0x2e) {
                // .
                if ((i && chunk[i - 1] === 0x0a) || (!i && (!this.lastByte || this.lastByte === 0x0a))) {
                    buf = chunk.slice(lastPos, i + 1);
                    chunks.push(buf);
                    chunks.push(Buffer.from('.'));
                    chunklen += buf.length + 1;
                    lastPos = i + 1;
                }
            } else if (chunk[i] === 0x0a) {
                // .
                if ((i && chunk[i - 1] !== 0x0d) || (!i && this.lastByte !== 0x0d)) {
                    if (i > lastPos) {
                        buf = chunk.slice(lastPos, i);
                        chunks.push(buf);
                        chunklen += buf.length + 2;
                    } else {
                        chunklen += 2;
                    }
                    chunks.push(Buffer.from('\r\n'));
                    lastPos = i + 1;
                }
            }
        }

        if (chunklen) {
            // add last piece
            if (lastPos < chunk.length) {
                buf = chunk.slice(lastPos);
                chunks.push(buf);
                chunklen += buf.length;
            }

            this.outByteCount += chunklen;
            this.push(Buffer.concat(chunks, chunklen));
        } else {
            this.outByteCount += chunk.length;
            this.push(chunk);
        }

        this.lastByte = chunk[chunk.length - 1];
        done();
    }

    /**
     * Finalizes the stream with a dot on a single line
     */
    _flush(done) {
        let buf;
        if (this.lastByte === 0x0a) {
            buf = Buffer.from('.\r\n');
        } else if (this.lastByte === 0x0d) {
            buf = Buffer.from('\n.\r\n');
        } else {
            buf = Buffer.from('\r\n.\r\n');
        }
        this.outByteCount += buf.length;
        this.push(buf);
        done();
    }
}

module.exports = DataStream;


/***/ }),

/***/ 2790:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";


/**
 * Minimal HTTP/S proxy client
 */

const net = __webpack_require__(1631);
const tls = __webpack_require__(4016);
const urllib = __webpack_require__(8835);

/**
 * Establishes proxied connection to destinationPort
 *
 * httpProxyClient("http://localhost:3128/", 80, "google.com", function(err, socket){
 *     socket.write("GET / HTTP/1.0\r\n\r\n");
 * });
 *
 * @param {String} proxyUrl proxy configuration, etg "http://proxy.host:3128/"
 * @param {Number} destinationPort Port to open in destination host
 * @param {String} destinationHost Destination hostname
 * @param {Function} callback Callback to run with the rocket object once connection is established
 */
function httpProxyClient(proxyUrl, destinationPort, destinationHost, callback) {
    let proxy = urllib.parse(proxyUrl);

    // create a socket connection to the proxy server
    let options;
    let connect;
    let socket;

    options = {
        host: proxy.hostname,
        port: Number(proxy.port) ? Number(proxy.port) : proxy.protocol === 'https:' ? 443 : 80
    };

    if (proxy.protocol === 'https:') {
        // we can use untrusted proxies as long as we verify actual SMTP certificates
        options.rejectUnauthorized = false;
        connect = tls.connect.bind(tls);
    } else {
        connect = net.connect.bind(net);
    }

    // Error harness for initial connection. Once connection is established, the responsibility
    // to handle errors is passed to whoever uses this socket
    let finished = false;
    let tempSocketErr = function(err) {
        if (finished) {
            return;
        }
        finished = true;
        try {
            socket.destroy();
        } catch (E) {
            // ignore
        }
        callback(err);
    };

    socket = connect(options, () => {
        if (finished) {
            return;
        }

        let reqHeaders = {
            Host: destinationHost + ':' + destinationPort,
            Connection: 'close'
        };
        if (proxy.auth) {
            reqHeaders['Proxy-Authorization'] = 'Basic ' + Buffer.from(proxy.auth).toString('base64');
        }

        socket.write(
            // HTTP method
            'CONNECT ' +
                destinationHost +
                ':' +
                destinationPort +
                ' HTTP/1.1\r\n' +
                // HTTP request headers
                Object.keys(reqHeaders)
                    .map(key => key + ': ' + reqHeaders[key])
                    .join('\r\n') +
                // End request
                '\r\n\r\n'
        );

        let headers = '';
        let onSocketData = chunk => {
            let match;
            let remainder;

            if (finished) {
                return;
            }

            headers += chunk.toString('binary');
            if ((match = headers.match(/\r\n\r\n/))) {
                socket.removeListener('data', onSocketData);

                remainder = headers.substr(match.index + match[0].length);
                headers = headers.substr(0, match.index);
                if (remainder) {
                    socket.unshift(Buffer.from(remainder, 'binary'));
                }

                // proxy connection is now established
                finished = true;

                // check response code
                match = headers.match(/^HTTP\/\d+\.\d+ (\d+)/i);
                if (!match || (match[1] || '').charAt(0) !== '2') {
                    try {
                        socket.destroy();
                    } catch (E) {
                        // ignore
                    }
                    return callback(new Error('Invalid response from proxy' + ((match && ': ' + match[1]) || '')));
                }

                socket.removeListener('error', tempSocketErr);
                return callback(null, socket);
            }
        };
        socket.on('data', onSocketData);
    });

    socket.once('error', tempSocketErr);
}

module.exports = httpProxyClient;


/***/ }),

/***/ 3559:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";


const packageInfo = __webpack_require__(7643);
const EventEmitter = __webpack_require__(8614).EventEmitter;
const net = __webpack_require__(1631);
const tls = __webpack_require__(4016);
const os = __webpack_require__(2087);
const crypto = __webpack_require__(6417);
const DataStream = __webpack_require__(4447);
const PassThrough = __webpack_require__(2413).PassThrough;
const shared = __webpack_require__(2673);

// default timeout values in ms
const CONNECTION_TIMEOUT = 2 * 60 * 1000; // how much to wait for the connection to be established
const SOCKET_TIMEOUT = 10 * 60 * 1000; // how much to wait for socket inactivity before disconnecting the client
const GREETING_TIMEOUT = 30 * 1000; // how much to wait after connection is established but SMTP greeting is not receieved

/**
 * Generates a SMTP connection object
 *
 * Optional options object takes the following possible properties:
 *
 *  * **port** - is the port to connect to (defaults to 587 or 465)
 *  * **host** - is the hostname or IP address to connect to (defaults to 'localhost')
 *  * **secure** - use SSL
 *  * **ignoreTLS** - ignore server support for STARTTLS
 *  * **requireTLS** - forces the client to use STARTTLS
 *  * **name** - the name of the client server
 *  * **localAddress** - outbound address to bind to (see: http://nodejs.org/api/net.html#net_net_connect_options_connectionlistener)
 *  * **greetingTimeout** - Time to wait in ms until greeting message is received from the server (defaults to 10000)
 *  * **connectionTimeout** - how many milliseconds to wait for the connection to establish
 *  * **socketTimeout** - Time of inactivity until the connection is closed (defaults to 1 hour)
 *  * **lmtp** - if true, uses LMTP instead of SMTP protocol
 *  * **logger** - bunyan compatible logger interface
 *  * **debug** - if true pass SMTP traffic to the logger
 *  * **tls** - options for createCredentials
 *  * **socket** - existing socket to use instead of creating a new one (see: http://nodejs.org/api/net.html#net_class_net_socket)
 *  * **secured** - boolean indicates that the provided socket has already been upgraded to tls
 *
 * @constructor
 * @namespace SMTP Client module
 * @param {Object} [options] Option properties
 */
class SMTPConnection extends EventEmitter {
    constructor(options) {
        super(options);

        this.id = crypto
            .randomBytes(8)
            .toString('base64')
            .replace(/\W/g, '');
        this.stage = 'init';

        this.options = options || {};

        this.secureConnection = !!this.options.secure;
        this.alreadySecured = !!this.options.secured;

        this.port = Number(this.options.port) || (this.secureConnection ? 465 : 587);
        this.host = this.options.host || 'localhost';

        if (typeof this.options.secure === 'undefined' && this.port === 465) {
            // if secure option is not set but port is 465, then default to secure
            this.secureConnection = true;
        }

        this.name = this.options.name || this._getHostname();

        this.logger = shared.getLogger(this.options, {
            component: this.options.component || 'smtp-connection',
            sid: this.id
        });

        this.customAuth = new Map();
        Object.keys(this.options.customAuth || {}).forEach(key => {
            let mapKey = (key || '')
                .toString()
                .trim()
                .toUpperCase();
            if (!mapKey) {
                return;
            }
            this.customAuth.set(mapKey, this.options.customAuth[key]);
        });

        /**
         * Expose version nr, just for the reference
         * @type {String}
         */
        this.version = packageInfo.version;

        /**
         * If true, then the user is authenticated
         * @type {Boolean}
         */
        this.authenticated = false;

        /**
         * If set to true, this instance is no longer active
         * @private
         */
        this.destroyed = false;

        /**
         * Defines if the current connection is secure or not. If not,
         * STARTTLS can be used if available
         * @private
         */
        this.secure = !!this.secureConnection;

        /**
         * Store incomplete messages coming from the server
         * @private
         */
        this._remainder = '';

        /**
         * Unprocessed responses from the server
         * @type {Array}
         */
        this._responseQueue = [];

        this.lastServerResponse = false;

        /**
         * The socket connecting to the server
         * @publick
         */
        this._socket = false;

        /**
         * Lists supported auth mechanisms
         * @private
         */
        this._supportedAuth = [];

        /**
         * Set to true, if EHLO response includes "AUTH".
         * If false then authentication is not tried
         */
        this.allowsAuth = false;

        /**
         * Includes current envelope (from, to)
         * @private
         */
        this._envelope = false;

        /**
         * Lists supported extensions
         * @private
         */
        this._supportedExtensions = [];

        /**
         * Defines the maximum allowed size for a single message
         * @private
         */
        this._maxAllowedSize = 0;

        /**
         * Function queue to run if a data chunk comes from the server
         * @private
         */
        this._responseActions = [];
        this._recipientQueue = [];

        /**
         * Timeout variable for waiting the greeting
         * @private
         */
        this._greetingTimeout = false;

        /**
         * Timeout variable for waiting the connection to start
         * @private
         */
        this._connectionTimeout = false;

        /**
         * If the socket is deemed already closed
         * @private
         */
        this._destroyed = false;

        /**
         * If the socket is already being closed
         * @private
         */
        this._closing = false;

        /**
         * Callbacks for socket's listeners
         */
        this._onSocketData = chunk => this._onData(chunk);
        this._onSocketError = error => this._onError(error, 'ESOCKET', false, 'CONN');
        this._onSocketClose = () => this._onClose();
        this._onSocketEnd = () => this._onEnd();
        this._onSocketTimeout = () => this._onTimeout();
    }

    /**
     * Creates a connection to a SMTP server and sets up connection
     * listener
     */
    connect(connectCallback) {
        if (typeof connectCallback === 'function') {
            this.once('connect', () => {
                this.logger.debug(
                    {
                        tnx: 'smtp'
                    },
                    'SMTP handshake finished'
                );
                connectCallback();
            });

            const isDestroyedMessage = this._isDestroyedMessage('connect');
            if (isDestroyedMessage) {
                return connectCallback(this._formatError(isDestroyedMessage, 'ECONNECTION', false, 'CONN'));
            }
        }

        let opts = {
            port: this.port,
            host: this.host
        };

        if (this.options.localAddress) {
            opts.localAddress = this.options.localAddress;
        }

        let setupConnectionHandlers = () => {
            this._connectionTimeout = setTimeout(() => {
                this._onError('Connection timeout', 'ETIMEDOUT', false, 'CONN');
            }, this.options.connectionTimeout || CONNECTION_TIMEOUT);

            this._socket.on('error', this._onSocketError);
        };

        if (this.options.connection) {
            // connection is already opened
            this._socket = this.options.connection;
            if (this.secureConnection && !this.alreadySecured) {
                setImmediate(() =>
                    this._upgradeConnection(err => {
                        if (err) {
                            this._onError(new Error('Error initiating TLS - ' + (err.message || err)), 'ETLS', false, 'CONN');
                            return;
                        }
                        this._onConnect();
                    })
                );
            } else {
                setImmediate(() => this._onConnect());
            }
            return;
        } else if (this.options.socket) {
            // socket object is set up but not yet connected
            this._socket = this.options.socket;
            return shared.resolveHostname(opts, (err, resolved) => {
                if (err) {
                    return setImmediate(() => this._onError(err, 'EDNS', false, 'CONN'));
                }
                this.logger.debug(
                    {
                        tnx: 'dns',
                        source: opts.host,
                        resolved: resolved.host,
                        cached: !!resolved._cached
                    },
                    'Resolved %s as %s [cache %s]',
                    opts.host,
                    resolved.host,
                    resolved._cached ? 'hit' : 'miss'
                );
                Object.keys(resolved).forEach(key => {
                    if (key.charAt(0) !== '_' && resolved[key]) {
                        opts[key] = resolved[key];
                    }
                });
                try {
                    this._socket.connect(this.port, this.host, () => {
                        this._socket.setKeepAlive(true);
                        this._onConnect();
                    });
                    setupConnectionHandlers();
                } catch (E) {
                    return setImmediate(() => this._onError(E, 'ECONNECTION', false, 'CONN'));
                }
            });
        } else if (this.secureConnection) {
            // connect using tls
            if (this.options.tls) {
                Object.keys(this.options.tls).forEach(key => {
                    opts[key] = this.options.tls[key];
                });
            }
            return shared.resolveHostname(opts, (err, resolved) => {
                if (err) {
                    return setImmediate(() => this._onError(err, 'EDNS', false, 'CONN'));
                }
                this.logger.debug(
                    {
                        tnx: 'dns',
                        source: opts.host,
                        resolved: resolved.host,
                        cached: !!resolved._cached
                    },
                    'Resolved %s as %s [cache %s]',
                    opts.host,
                    resolved.host,
                    resolved._cached ? 'hit' : 'miss'
                );
                Object.keys(resolved).forEach(key => {
                    if (key.charAt(0) !== '_' && resolved[key]) {
                        opts[key] = resolved[key];
                    }
                });
                try {
                    this._socket = tls.connect(opts, () => {
                        this._socket.setKeepAlive(true);
                        this._onConnect();
                    });
                    setupConnectionHandlers();
                } catch (E) {
                    return setImmediate(() => this._onError(E, 'ECONNECTION', false, 'CONN'));
                }
            });
        } else {
            // connect using plaintext
            return shared.resolveHostname(opts, (err, resolved) => {
                if (err) {
                    return setImmediate(() => this._onError(err, 'EDNS', false, 'CONN'));
                }
                this.logger.debug(
                    {
                        tnx: 'dns',
                        source: opts.host,
                        resolved: resolved.host,
                        cached: !!resolved._cached
                    },
                    'Resolved %s as %s [cache %s]',
                    opts.host,
                    resolved.host,
                    resolved._cached ? 'hit' : 'miss'
                );
                Object.keys(resolved).forEach(key => {
                    if (key.charAt(0) !== '_' && resolved[key]) {
                        opts[key] = resolved[key];
                    }
                });
                try {
                    this._socket = net.connect(opts, () => {
                        this._socket.setKeepAlive(true);
                        this._onConnect();
                    });
                    setupConnectionHandlers();
                } catch (E) {
                    return setImmediate(() => this._onError(E, 'ECONNECTION', false, 'CONN'));
                }
            });
        }
    }

    /**
     * Sends QUIT
     */
    quit() {
        this._sendCommand('QUIT');
        this._responseActions.push(this.close);
    }

    /**
     * Closes the connection to the server
     */
    close() {
        clearTimeout(this._connectionTimeout);
        clearTimeout(this._greetingTimeout);
        this._responseActions = [];

        // allow to run this function only once
        if (this._closing) {
            return;
        }
        this._closing = true;

        let closeMethod = 'end';

        if (this.stage === 'init') {
            // Close the socket immediately when connection timed out
            closeMethod = 'destroy';
        }

        this.logger.debug(
            {
                tnx: 'smtp'
            },
            'Closing connection to the server using "%s"',
            closeMethod
        );

        let socket = (this._socket && this._socket.socket) || this._socket;

        if (socket && !socket.destroyed) {
            try {
                this._socket[closeMethod]();
            } catch (E) {
                // just ignore
            }
        }

        this._destroy();
    }

    /**
     * Authenticate user
     */
    login(authData, callback) {
        const isDestroyedMessage = this._isDestroyedMessage('login');
        if (isDestroyedMessage) {
            return callback(this._formatError(isDestroyedMessage, 'ECONNECTION', false, 'API'));
        }

        this._auth = authData || {};
        // Select SASL authentication method
        this._authMethod =
            (this._auth.method || '')
                .toString()
                .trim()
                .toUpperCase() || false;

        if (!this._authMethod && this._auth.oauth2 && !this._auth.credentials) {
            this._authMethod = 'XOAUTH2';
        } else if (!this._authMethod || (this._authMethod === 'XOAUTH2' && !this._auth.oauth2)) {
            // use first supported
            this._authMethod = (this._supportedAuth[0] || 'PLAIN').toUpperCase().trim();
        }

        if (this._authMethod !== 'XOAUTH2' && (!this._auth.credentials || !this._auth.credentials.user || !this._auth.credentials.pass)) {
            if (this._auth.user && this._auth.pass) {
                this._auth.credentials = {
                    user: this._auth.user,
                    pass: this._auth.pass,
                    options: this._auth.options
                };
            } else {
                return callback(this._formatError('Missing credentials for "' + this._authMethod + '"', 'EAUTH', false, 'API'));
            }
        }

        if (this.customAuth.has(this._authMethod)) {
            let handler = this.customAuth.get(this._authMethod);
            let lastResponse;
            let returned = false;

            let resolve = () => {
                if (returned) {
                    return;
                }
                returned = true;
                this.logger.info(
                    {
                        tnx: 'smtp',
                        username: this._auth.user,
                        action: 'authenticated',
                        method: this._authMethod
                    },
                    'User %s authenticated',
                    JSON.stringify(this._auth.user)
                );
                this.authenticated = true;
                callback(null, true);
            };

            let reject = err => {
                if (returned) {
                    return;
                }
                returned = true;
                callback(this._formatError(err, 'EAUTH', lastResponse, 'AUTH ' + this._authMethod));
            };

            let handlerResponse = handler({
                auth: this._auth,
                method: this._authMethod,

                extensions: [].concat(this._supportedExtensions),
                authMethods: [].concat(this._supportedAuth),
                maxAllowedSize: this._maxAllowedSize || false,

                sendCommand: (cmd, done) => {
                    let promise;

                    if (!done) {
                        promise = new Promise((resolve, reject) => {
                            done = shared.callbackPromise(resolve, reject);
                        });
                    }

                    this._responseActions.push(str => {
                        lastResponse = str;

                        let codes = str.match(/^(\d+)(?:\s(\d+\.\d+\.\d+))?\s/);
                        let data = {
                            command: cmd,
                            response: str
                        };
                        if (codes) {
                            data.status = Number(codes[1]) || 0;
                            if (codes[2]) {
                                data.code = codes[2];
                            }
                            data.text = str.substr(codes[0].length);
                        } else {
                            data.text = str;
                            data.status = 0; // just in case we need to perform numeric comparisons
                        }
                        done(null, data);
                    });
                    setImmediate(() => this._sendCommand(cmd));

                    return promise;
                },

                resolve,
                reject
            });

            if (handlerResponse && typeof handlerResponse.catch === 'function') {
                // a promise was returned
                handlerResponse.then(resolve).catch(reject);
            }

            return;
        }

        switch (this._authMethod) {
            case 'XOAUTH2':
                this._handleXOauth2Token(false, callback);
                return;
            case 'LOGIN':
                this._responseActions.push(str => {
                    this._actionAUTH_LOGIN_USER(str, callback);
                });
                this._sendCommand('AUTH LOGIN');
                return;
            case 'PLAIN':
                this._responseActions.push(str => {
                    this._actionAUTHComplete(str, callback);
                });
                this._sendCommand(
                    'AUTH PLAIN ' +
                        Buffer.from(
                            //this._auth.user+'\u0000'+
                            '\u0000' + // skip authorization identity as it causes problems with some servers
                                this._auth.credentials.user +
                                '\u0000' +
                                this._auth.credentials.pass,
                            'utf-8'
                        ).toString('base64')
                );
                return;
            case 'CRAM-MD5':
                this._responseActions.push(str => {
                    this._actionAUTH_CRAM_MD5(str, callback);
                });
                this._sendCommand('AUTH CRAM-MD5');
                return;
        }

        return callback(this._formatError('Unknown authentication method "' + this._authMethod + '"', 'EAUTH', false, 'API'));
    }

    /**
     * Sends a message
     *
     * @param {Object} envelope Envelope object, {from: addr, to: [addr]}
     * @param {Object} message String, Buffer or a Stream
     * @param {Function} callback Callback to return once sending is completed
     */
    send(envelope, message, done) {
        if (!message) {
            return done(this._formatError('Empty message', 'EMESSAGE', false, 'API'));
        }

        const isDestroyedMessage = this._isDestroyedMessage('send message');
        if (isDestroyedMessage) {
            return done(this._formatError(isDestroyedMessage, 'ECONNECTION', false, 'API'));
        }

        // reject larger messages than allowed
        if (this._maxAllowedSize && envelope.size > this._maxAllowedSize) {
            return setImmediate(() => {
                done(this._formatError('Message size larger than allowed ' + this._maxAllowedSize, 'EMESSAGE', false, 'MAIL FROM'));
            });
        }

        // ensure that callback is only called once
        let returned = false;
        let callback = function() {
            if (returned) {
                return;
            }
            returned = true;

            done(...arguments);
        };

        if (typeof message.on === 'function') {
            message.on('error', err => callback(this._formatError(err, 'ESTREAM', false, 'API')));
        }

        let startTime = Date.now();
        this._setEnvelope(envelope, (err, info) => {
            if (err) {
                return callback(err);
            }
            let envelopeTime = Date.now();
            let stream = this._createSendStream((err, str) => {
                if (err) {
                    return callback(err);
                }

                info.envelopeTime = envelopeTime - startTime;
                info.messageTime = Date.now() - envelopeTime;
                info.messageSize = stream.outByteCount;
                info.response = str;

                return callback(null, info);
            });
            if (typeof message.pipe === 'function') {
                message.pipe(stream);
            } else {
                stream.write(message);
                stream.end();
            }
        });
    }

    /**
     * Resets connection state
     *
     * @param {Function} callback Callback to return once connection is reset
     */
    reset(callback) {
        this._sendCommand('RSET');
        this._responseActions.push(str => {
            if (str.charAt(0) !== '2') {
                return callback(this._formatError('Could not reset session state. response=' + str, 'EPROTOCOL', str, 'RSET'));
            }
            this._envelope = false;
            return callback(null, true);
        });
    }

    /**
     * Connection listener that is run when the connection to
     * the server is opened
     *
     * @event
     */
    _onConnect() {
        clearTimeout(this._connectionTimeout);

        this.logger.info(
            {
                tnx: 'network',
                localAddress: this._socket.localAddress,
                localPort: this._socket.localPort,
                remoteAddress: this._socket.remoteAddress,
                remotePort: this._socket.remotePort
            },
            '%s established to %s:%s',
            this.secure ? 'Secure connection' : 'Connection',
            this._socket.remoteAddress,
            this._socket.remotePort
        );

        if (this._destroyed) {
            // Connection was established after we already had canceled it
            this.close();
            return;
        }

        this.stage = 'connected';

        // clear existing listeners for the socket
        this._socket.removeListener('data', this._onSocketData);
        this._socket.removeListener('timeout', this._onSocketTimeout);
        this._socket.removeListener('close', this._onSocketClose);
        this._socket.removeListener('end', this._onSocketEnd);

        this._socket.on('data', this._onSocketData);
        this._socket.once('close', this._onSocketClose);
        this._socket.once('end', this._onSocketEnd);

        this._socket.setTimeout(this.options.socketTimeout || SOCKET_TIMEOUT);
        this._socket.on('timeout', this._onSocketTimeout);

        this._greetingTimeout = setTimeout(() => {
            // if still waiting for greeting, give up
            if (this._socket && !this._destroyed && this._responseActions[0] === this._actionGreeting) {
                this._onError('Greeting never received', 'ETIMEDOUT', false, 'CONN');
            }
        }, this.options.greetingTimeout || GREETING_TIMEOUT);

        this._responseActions.push(this._actionGreeting);

        // we have a 'data' listener set up so resume socket if it was paused
        this._socket.resume();
    }

    /**
     * 'data' listener for data coming from the server
     *
     * @event
     * @param {Buffer} chunk Data chunk coming from the server
     */
    _onData(chunk) {
        if (this._destroyed || !chunk || !chunk.length) {
            return;
        }

        let data = (chunk || '').toString('binary');
        let lines = (this._remainder + data).split(/\r?\n/);
        let lastline;

        this._remainder = lines.pop();

        for (let i = 0, len = lines.length; i < len; i++) {
            if (this._responseQueue.length) {
                lastline = this._responseQueue[this._responseQueue.length - 1];
                if (/^\d+-/.test(lastline.split('\n').pop())) {
                    this._responseQueue[this._responseQueue.length - 1] += '\n' + lines[i];
                    continue;
                }
            }
            this._responseQueue.push(lines[i]);
        }

        if (this._responseQueue.length) {
            lastline = this._responseQueue[this._responseQueue.length - 1];
            if (/^\d+-/.test(lastline.split('\n').pop())) {
                return;
            }
        }

        this._processResponse();
    }

    /**
     * 'error' listener for the socket
     *
     * @event
     * @param {Error} err Error object
     * @param {String} type Error name
     */
    _onError(err, type, data, command) {
        clearTimeout(this._connectionTimeout);
        clearTimeout(this._greetingTimeout);

        if (this._destroyed) {
            // just ignore, already closed
            // this might happen when a socket is canceled because of reached timeout
            // but the socket timeout error itself receives only after
            return;
        }

        err = this._formatError(err, type, data, command);

        this.logger.error(data, err.message);

        this.emit('error', err);
        this.close();
    }

    _formatError(message, type, response, command) {
        let err;

        if (/Error\]$/i.test(Object.prototype.toString.call(message))) {
            err = message;
        } else {
            err = new Error(message);
        }

        if (type && type !== 'Error') {
            err.code = type;
        }

        if (response) {
            err.response = response;
            err.message += ': ' + response;
        }

        let responseCode = (typeof response === 'string' && Number((response.match(/^\d+/) || [])[0])) || false;
        if (responseCode) {
            err.responseCode = responseCode;
        }

        if (command) {
            err.command = command;
        }

        return err;
    }

    /**
     * 'close' listener for the socket
     *
     * @event
     */
    _onClose() {
        this.logger.info(
            {
                tnx: 'network'
            },
            'Connection closed'
        );

        if (this.upgrading && !this._destroyed) {
            return this._onError(new Error('Connection closed unexpectedly'), 'ETLS', false, 'CONN');
        } else if (![this._actionGreeting, this.close].includes(this._responseActions[0]) && !this._destroyed) {
            return this._onError(new Error('Connection closed unexpectedly'), 'ECONNECTION', false, 'CONN');
        }

        this._destroy();
    }

    /**
     * 'end' listener for the socket
     *
     * @event
     */
    _onEnd() {
        if (this._socket && !this._socket.destroyed) {
            this._socket.destroy();
        }
    }

    /**
     * 'timeout' listener for the socket
     *
     * @event
     */
    _onTimeout() {
        return this._onError(new Error('Timeout'), 'ETIMEDOUT', false, 'CONN');
    }

    /**
     * Destroys the client, emits 'end'
     */
    _destroy() {
        if (this._destroyed) {
            return;
        }
        this._destroyed = true;
        this.emit('end');
    }

    /**
     * Upgrades the connection to TLS
     *
     * @param {Function} callback Callback function to run when the connection
     *        has been secured
     */
    _upgradeConnection(callback) {
        // do not remove all listeners or it breaks node v0.10 as there's
        // apparently a 'finish' event set that would be cleared as well

        // we can safely keep 'error', 'end', 'close' etc. events
        this._socket.removeListener('data', this._onSocketData); // incoming data is going to be gibberish from this point onwards
        this._socket.removeListener('timeout', this._onSocketTimeout); // timeout will be re-set for the new socket object

        let socketPlain = this._socket;
        let opts = {
            socket: this._socket,
            host: this.host
        };

        Object.keys(this.options.tls || {}).forEach(key => {
            opts[key] = this.options.tls[key];
        });

        this.upgrading = true;
        this._socket = tls.connect(opts, () => {
            this.secure = true;
            this.upgrading = false;
            this._socket.on('data', this._onSocketData);

            socketPlain.removeListener('close', this._onSocketClose);
            socketPlain.removeListener('end', this._onSocketEnd);

            return callback(null, true);
        });

        this._socket.on('error', this._onSocketError);
        this._socket.once('close', this._onSocketClose);
        this._socket.once('end', this._onSocketEnd);

        this._socket.setTimeout(this.options.socketTimeout || SOCKET_TIMEOUT); // 10 min.
        this._socket.on('timeout', this._onSocketTimeout);

        // resume in case the socket was paused
        socketPlain.resume();
    }

    /**
     * Processes queued responses from the server
     *
     * @param {Boolean} force If true, ignores _processing flag
     */
    _processResponse() {
        if (!this._responseQueue.length) {
            return false;
        }

        let str = (this.lastServerResponse = (this._responseQueue.shift() || '').toString());

        if (/^\d+-/.test(str.split('\n').pop())) {
            // keep waiting for the final part of multiline response
            return;
        }

        if (this.options.debug || this.options.transactionLog) {
            this.logger.debug(
                {
                    tnx: 'server'
                },
                str.replace(/\r?\n$/, '')
            );
        }

        if (!str.trim()) {
            // skip unexpected empty lines
            setImmediate(() => this._processResponse(true));
        }

        let action = this._responseActions.shift();

        if (typeof action === 'function') {
            action.call(this, str);
            setImmediate(() => this._processResponse(true));
        } else {
            return this._onError(new Error('Unexpected Response'), 'EPROTOCOL', str, 'CONN');
        }
    }

    /**
     * Send a command to the server, append \r\n
     *
     * @param {String} str String to be sent to the server
     */
    _sendCommand(str) {
        if (this._destroyed) {
            // Connection already closed, can't send any more data
            return;
        }

        if (this._socket.destroyed) {
            return this.close();
        }

        if (this.options.debug || this.options.transactionLog) {
            this.logger.debug(
                {
                    tnx: 'client'
                },
                (str || '').toString().replace(/\r?\n$/, '')
            );
        }

        this._socket.write(Buffer.from(str + '\r\n', 'utf-8'));
    }

    /**
     * Initiates a new message by submitting envelope data, starting with
     * MAIL FROM: command
     *
     * @param {Object} envelope Envelope object in the form of
     *        {from:'...', to:['...']}
     *        or
     *        {from:{address:'...',name:'...'}, to:[address:'...',name:'...']}
     */
    _setEnvelope(envelope, callback) {
        let args = [];
        let useSmtpUtf8 = false;

        this._envelope = envelope || {};
        this._envelope.from = ((this._envelope.from && this._envelope.from.address) || this._envelope.from || '').toString().trim();

        this._envelope.to = [].concat(this._envelope.to || []).map(to => ((to && to.address) || to || '').toString().trim());

        if (!this._envelope.to.length) {
            return callback(this._formatError('No recipients defined', 'EENVELOPE', false, 'API'));
        }

        if (this._envelope.from && /[\r\n<>]/.test(this._envelope.from)) {
            return callback(this._formatError('Invalid sender ' + JSON.stringify(this._envelope.from), 'EENVELOPE', false, 'API'));
        }

        // check if the sender address uses only ASCII characters,
        // otherwise require usage of SMTPUTF8 extension
        if (/[\x80-\uFFFF]/.test(this._envelope.from)) {
            useSmtpUtf8 = true;
        }

        for (let i = 0, len = this._envelope.to.length; i < len; i++) {
            if (!this._envelope.to[i] || /[\r\n<>]/.test(this._envelope.to[i])) {
                return callback(this._formatError('Invalid recipient ' + JSON.stringify(this._envelope.to[i]), 'EENVELOPE', false, 'API'));
            }

            // check if the recipients addresses use only ASCII characters,
            // otherwise require usage of SMTPUTF8 extension
            if (/[\x80-\uFFFF]/.test(this._envelope.to[i])) {
                useSmtpUtf8 = true;
            }
        }

        // clone the recipients array for latter manipulation
        this._envelope.rcptQueue = JSON.parse(JSON.stringify(this._envelope.to || []));
        this._envelope.rejected = [];
        this._envelope.rejectedErrors = [];
        this._envelope.accepted = [];

        if (this._envelope.dsn) {
            try {
                this._envelope.dsn = this._setDsnEnvelope(this._envelope.dsn);
            } catch (err) {
                return callback(this._formatError('Invalid DSN ' + err.message, 'EENVELOPE', false, 'API'));
            }
        }

        this._responseActions.push(str => {
            this._actionMAIL(str, callback);
        });

        // If the server supports SMTPUTF8 and the envelope includes an internationalized
        // email address then append SMTPUTF8 keyword to the MAIL FROM command
        if (useSmtpUtf8 && this._supportedExtensions.includes('SMTPUTF8')) {
            args.push('SMTPUTF8');
            this._usingSmtpUtf8 = true;
        }

        // If the server supports 8BITMIME and the message might contain non-ascii bytes
        // then append the 8BITMIME keyword to the MAIL FROM command
        if (this._envelope.use8BitMime && this._supportedExtensions.includes('8BITMIME')) {
            args.push('BODY=8BITMIME');
            this._using8BitMime = true;
        }

        if (this._envelope.size && this._supportedExtensions.includes('SIZE')) {
            args.push('SIZE=' + this._envelope.size);
        }

        // If the server supports DSN and the envelope includes an DSN prop
        // then append DSN params to the MAIL FROM command
        if (this._envelope.dsn && this._supportedExtensions.includes('DSN')) {
            if (this._envelope.dsn.ret) {
                args.push('RET=' + shared.encodeXText(this._envelope.dsn.ret));
            }
            if (this._envelope.dsn.envid) {
                args.push('ENVID=' + shared.encodeXText(this._envelope.dsn.envid));
            }
        }

        this._sendCommand('MAIL FROM:<' + this._envelope.from + '>' + (args.length ? ' ' + args.join(' ') : ''));
    }

    _setDsnEnvelope(params) {
        let ret = (params.ret || params.return || '').toString().toUpperCase() || null;
        if (ret) {
            switch (ret) {
                case 'HDRS':
                case 'HEADERS':
                    ret = 'HDRS';
                    break;
                case 'FULL':
                case 'BODY':
                    ret = 'FULL';
                    break;
            }
        }

        if (ret && !['FULL', 'HDRS'].includes(ret)) {
            throw new Error('ret: ' + JSON.stringify(ret));
        }

        let envid = (params.envid || params.id || '').toString() || null;

        let notify = params.notify || null;
        if (notify) {
            if (typeof notify === 'string') {
                notify = notify.split(',');
            }
            notify = notify.map(n => n.trim().toUpperCase());
            let validNotify = ['NEVER', 'SUCCESS', 'FAILURE', 'DELAY'];
            let invaliNotify = notify.filter(n => !validNotify.includes(n));
            if (invaliNotify.length || (notify.length > 1 && notify.includes('NEVER'))) {
                throw new Error('notify: ' + JSON.stringify(notify.join(',')));
            }
            notify = notify.join(',');
        }

        let orcpt = (params.orcpt || params.recipient || '').toString() || null;
        if (orcpt && orcpt.indexOf(';') < 0) {
            orcpt = 'rfc822;' + orcpt;
        }

        return {
            ret,
            envid,
            notify,
            orcpt
        };
    }

    _getDsnRcptToArgs() {
        let args = [];
        // If the server supports DSN and the envelope includes an DSN prop
        // then append DSN params to the RCPT TO command
        if (this._envelope.dsn && this._supportedExtensions.includes('DSN')) {
            if (this._envelope.dsn.notify) {
                args.push('NOTIFY=' + shared.encodeXText(this._envelope.dsn.notify));
            }
            if (this._envelope.dsn.orcpt) {
                args.push('ORCPT=' + shared.encodeXText(this._envelope.dsn.orcpt));
            }
        }
        return args.length ? ' ' + args.join(' ') : '';
    }

    _createSendStream(callback) {
        let dataStream = new DataStream();
        let logStream;

        if (this.options.lmtp) {
            this._envelope.accepted.forEach((recipient, i) => {
                let final = i === this._envelope.accepted.length - 1;
                this._responseActions.push(str => {
                    this._actionLMTPStream(recipient, final, str, callback);
                });
            });
        } else {
            this._responseActions.push(str => {
                this._actionSMTPStream(str, callback);
            });
        }

        dataStream.pipe(this._socket, {
            end: false
        });

        if (this.options.debug) {
            logStream = new PassThrough();
            logStream.on('readable', () => {
                let chunk;
                while ((chunk = logStream.read())) {
                    this.logger.debug(
                        {
                            tnx: 'message'
                        },
                        chunk.toString('binary').replace(/\r?\n$/, '')
                    );
                }
            });
            dataStream.pipe(logStream);
        }

        dataStream.once('end', () => {
            this.logger.info(
                {
                    tnx: 'message',
                    inByteCount: dataStream.inByteCount,
                    outByteCount: dataStream.outByteCount
                },
                '<%s bytes encoded mime message (source size %s bytes)>',
                dataStream.outByteCount,
                dataStream.inByteCount
            );
        });

        return dataStream;
    }

    /** ACTIONS **/

    /**
     * Will be run after the connection is created and the server sends
     * a greeting. If the incoming message starts with 220 initiate
     * SMTP session by sending EHLO command
     *
     * @param {String} str Message from the server
     */
    _actionGreeting(str) {
        clearTimeout(this._greetingTimeout);

        if (str.substr(0, 3) !== '220') {
            this._onError(new Error('Invalid greeting. response=' + str), 'EPROTOCOL', str, 'CONN');
            return;
        }

        if (this.options.lmtp) {
            this._responseActions.push(this._actionLHLO);
            this._sendCommand('LHLO ' + this.name);
        } else {
            this._responseActions.push(this._actionEHLO);
            this._sendCommand('EHLO ' + this.name);
        }
    }

    /**
     * Handles server response for LHLO command. If it yielded in
     * error, emit 'error', otherwise treat this as an EHLO response
     *
     * @param {String} str Message from the server
     */
    _actionLHLO(str) {
        if (str.charAt(0) !== '2') {
            this._onError(new Error('Invalid LHLO. response=' + str), 'EPROTOCOL', str, 'LHLO');
            return;
        }

        this._actionEHLO(str);
    }

    /**
     * Handles server response for EHLO command. If it yielded in
     * error, try HELO instead, otherwise initiate TLS negotiation
     * if STARTTLS is supported by the server or move into the
     * authentication phase.
     *
     * @param {String} str Message from the server
     */
    _actionEHLO(str) {
        let match;

        if (str.substr(0, 3) === '421') {
            this._onError(new Error('Server terminates connection. response=' + str), 'ECONNECTION', str, 'EHLO');
            return;
        }

        if (str.charAt(0) !== '2') {
            if (this.options.requireTLS) {
                this._onError(new Error('EHLO failed but HELO does not support required STARTTLS. response=' + str), 'ECONNECTION', str, 'EHLO');
                return;
            }

            // Try HELO instead
            this._responseActions.push(this._actionHELO);
            this._sendCommand('HELO ' + this.name);
            return;
        }

        // Detect if the server supports STARTTLS
        if (!this.secure && !this.options.ignoreTLS && (/[ -]STARTTLS\b/im.test(str) || this.options.requireTLS)) {
            this._sendCommand('STARTTLS');
            this._responseActions.push(this._actionSTARTTLS);
            return;
        }

        // Detect if the server supports SMTPUTF8
        if (/[ -]SMTPUTF8\b/im.test(str)) {
            this._supportedExtensions.push('SMTPUTF8');
        }

        // Detect if the server supports DSN
        if (/[ -]DSN\b/im.test(str)) {
            this._supportedExtensions.push('DSN');
        }

        // Detect if the server supports 8BITMIME
        if (/[ -]8BITMIME\b/im.test(str)) {
            this._supportedExtensions.push('8BITMIME');
        }

        // Detect if the server supports PIPELINING
        if (/[ -]PIPELINING\b/im.test(str)) {
            this._supportedExtensions.push('PIPELINING');
        }

        // Detect if the server supports AUTH
        if (/[ -]AUTH\b/i.test(str)) {
            this.allowsAuth = true;
        }

        // Detect if the server supports PLAIN auth
        if (/[ -]AUTH(?:(\s+|=)[^\n]*\s+|\s+|=)PLAIN/i.test(str)) {
            this._supportedAuth.push('PLAIN');
        }

        // Detect if the server supports LOGIN auth
        if (/[ -]AUTH(?:(\s+|=)[^\n]*\s+|\s+|=)LOGIN/i.test(str)) {
            this._supportedAuth.push('LOGIN');
        }

        // Detect if the server supports CRAM-MD5 auth
        if (/[ -]AUTH(?:(\s+|=)[^\n]*\s+|\s+|=)CRAM-MD5/i.test(str)) {
            this._supportedAuth.push('CRAM-MD5');
        }

        // Detect if the server supports XOAUTH2 auth
        if (/[ -]AUTH(?:(\s+|=)[^\n]*\s+|\s+|=)XOAUTH2/i.test(str)) {
            this._supportedAuth.push('XOAUTH2');
        }

        // Detect if the server supports SIZE extensions (and the max allowed size)
        if ((match = str.match(/[ -]SIZE(?:[ \t]+(\d+))?/im))) {
            this._supportedExtensions.push('SIZE');
            this._maxAllowedSize = Number(match[1]) || 0;
        }

        this.emit('connect');
    }

    /**
     * Handles server response for HELO command. If it yielded in
     * error, emit 'error', otherwise move into the authentication phase.
     *
     * @param {String} str Message from the server
     */
    _actionHELO(str) {
        if (str.charAt(0) !== '2') {
            this._onError(new Error('Invalid HELO. response=' + str), 'EPROTOCOL', str, 'HELO');
            return;
        }

        // assume that authentication is enabled (most probably is not though)
        this.allowsAuth = true;

        this.emit('connect');
    }

    /**
     * Handles server response for STARTTLS command. If there's an error
     * try HELO instead, otherwise initiate TLS upgrade. If the upgrade
     * succeedes restart the EHLO
     *
     * @param {String} str Message from the server
     */
    _actionSTARTTLS(str) {
        if (str.charAt(0) !== '2') {
            if (this.options.opportunisticTLS) {
                this.logger.info(
                    {
                        tnx: 'smtp'
                    },
                    'Failed STARTTLS upgrade, continuing unencrypted'
                );
                return this.emit('connect');
            }
            this._onError(new Error('Error upgrading connection with STARTTLS'), 'ETLS', str, 'STARTTLS');
            return;
        }

        this._upgradeConnection((err, secured) => {
            if (err) {
                this._onError(new Error('Error initiating TLS - ' + (err.message || err)), 'ETLS', false, 'STARTTLS');
                return;
            }

            this.logger.info(
                {
                    tnx: 'smtp'
                },
                'Connection upgraded with STARTTLS'
            );

            if (secured) {
                // restart session
                if (this.options.lmtp) {
                    this._responseActions.push(this._actionLHLO);
                    this._sendCommand('LHLO ' + this.name);
                } else {
                    this._responseActions.push(this._actionEHLO);
                    this._sendCommand('EHLO ' + this.name);
                }
            } else {
                this.emit('connect');
            }
        });
    }

    /**
     * Handle the response for AUTH LOGIN command. We are expecting
     * '334 VXNlcm5hbWU6' (base64 for 'Username:'). Data to be sent as
     * response needs to be base64 encoded username. We do not need
     * exact match but settle with 334 response in general as some
     * hosts invalidly use a longer message than VXNlcm5hbWU6
     *
     * @param {String} str Message from the server
     */
    _actionAUTH_LOGIN_USER(str, callback) {
        if (!/^334[ -]/.test(str)) {
            // expecting '334 VXNlcm5hbWU6'
            callback(this._formatError('Invalid login sequence while waiting for "334 VXNlcm5hbWU6"', 'EAUTH', str, 'AUTH LOGIN'));
            return;
        }

        this._responseActions.push(str => {
            this._actionAUTH_LOGIN_PASS(str, callback);
        });

        this._sendCommand(Buffer.from(this._auth.credentials.user + '', 'utf-8').toString('base64'));
    }

    /**
     * Handle the response for AUTH CRAM-MD5 command. We are expecting
     * '334 <challenge string>'. Data to be sent as response needs to be
     * base64 decoded challenge string, MD5 hashed using the password as
     * a HMAC key, prefixed by the username and a space, and finally all
     * base64 encoded again.
     *
     * @param {String} str Message from the server
     */
    _actionAUTH_CRAM_MD5(str, callback) {
        let challengeMatch = str.match(/^334\s+(.+)$/);
        let challengeString = '';

        if (!challengeMatch) {
            return callback(this._formatError('Invalid login sequence while waiting for server challenge string', 'EAUTH', str, 'AUTH CRAM-MD5'));
        } else {
            challengeString = challengeMatch[1];
        }

        // Decode from base64
        let base64decoded = Buffer.from(challengeString, 'base64').toString('ascii'),
            hmac_md5 = crypto.createHmac('md5', this._auth.credentials.pass);

        hmac_md5.update(base64decoded);

        let hex_hmac = hmac_md5.digest('hex');
        let prepended = this._auth.credentials.user + ' ' + hex_hmac;

        this._responseActions.push(str => {
            this._actionAUTH_CRAM_MD5_PASS(str, callback);
        });

        this._sendCommand(Buffer.from(prepended).toString('base64'));
    }

    /**
     * Handles the response to CRAM-MD5 authentication, if there's no error,
     * the user can be considered logged in. Start waiting for a message to send
     *
     * @param {String} str Message from the server
     */
    _actionAUTH_CRAM_MD5_PASS(str, callback) {
        if (!str.match(/^235\s+/)) {
            return callback(this._formatError('Invalid login sequence while waiting for "235"', 'EAUTH', str, 'AUTH CRAM-MD5'));
        }

        this.logger.info(
            {
                tnx: 'smtp',
                username: this._auth.user,
                action: 'authenticated',
                method: this._authMethod
            },
            'User %s authenticated',
            JSON.stringify(this._auth.user)
        );
        this.authenticated = true;
        callback(null, true);
    }

    /**
     * Handle the response for AUTH LOGIN command. We are expecting
     * '334 UGFzc3dvcmQ6' (base64 for 'Password:'). Data to be sent as
     * response needs to be base64 encoded password.
     *
     * @param {String} str Message from the server
     */
    _actionAUTH_LOGIN_PASS(str, callback) {
        if (!/^334[ -]/.test(str)) {
            // expecting '334 UGFzc3dvcmQ6'
            return callback(this._formatError('Invalid login sequence while waiting for "334 UGFzc3dvcmQ6"', 'EAUTH', str, 'AUTH LOGIN'));
        }

        this._responseActions.push(str => {
            this._actionAUTHComplete(str, callback);
        });

        this._sendCommand(Buffer.from(this._auth.credentials.pass + '', 'utf-8').toString('base64'));
    }

    /**
     * Handles the response for authentication, if there's no error,
     * the user can be considered logged in. Start waiting for a message to send
     *
     * @param {String} str Message from the server
     */
    _actionAUTHComplete(str, isRetry, callback) {
        if (!callback && typeof isRetry === 'function') {
            callback = isRetry;
            isRetry = false;
        }

        if (str.substr(0, 3) === '334') {
            this._responseActions.push(str => {
                if (isRetry || this._authMethod !== 'XOAUTH2') {
                    this._actionAUTHComplete(str, true, callback);
                } else {
                    // fetch a new OAuth2 access token
                    setImmediate(() => this._handleXOauth2Token(true, callback));
                }
            });
            this._sendCommand('');
            return;
        }

        if (str.charAt(0) !== '2') {
            this.logger.info(
                {
                    tnx: 'smtp',
                    username: this._auth.user,
                    action: 'authfail',
                    method: this._authMethod
                },
                'User %s failed to authenticate',
                JSON.stringify(this._auth.user)
            );
            return callback(this._formatError('Invalid login', 'EAUTH', str, 'AUTH ' + this._authMethod));
        }

        this.logger.info(
            {
                tnx: 'smtp',
                username: this._auth.user,
                action: 'authenticated',
                method: this._authMethod
            },
            'User %s authenticated',
            JSON.stringify(this._auth.user)
        );
        this.authenticated = true;
        callback(null, true);
    }

    /**
     * Handle response for a MAIL FROM: command
     *
     * @param {String} str Message from the server
     */
    _actionMAIL(str, callback) {
        let message, curRecipient;
        if (Number(str.charAt(0)) !== 2) {
            if (this._usingSmtpUtf8 && /^550 /.test(str) && /[\x80-\uFFFF]/.test(this._envelope.from)) {
                message = 'Internationalized mailbox name not allowed';
            } else {
                message = 'Mail command failed';
            }
            return callback(this._formatError(message, 'EENVELOPE', str, 'MAIL FROM'));
        }

        if (!this._envelope.rcptQueue.length) {
            return callback(this._formatError('Can\x27t send mail - no recipients defined', 'EENVELOPE', false, 'API'));
        } else {
            this._recipientQueue = [];

            if (this._supportedExtensions.includes('PIPELINING')) {
                while (this._envelope.rcptQueue.length) {
                    curRecipient = this._envelope.rcptQueue.shift();
                    this._recipientQueue.push(curRecipient);
                    this._responseActions.push(str => {
                        this._actionRCPT(str, callback);
                    });
                    this._sendCommand('RCPT TO:<' + curRecipient + '>' + this._getDsnRcptToArgs());
                }
            } else {
                curRecipient = this._envelope.rcptQueue.shift();
                this._recipientQueue.push(curRecipient);
                this._responseActions.push(str => {
                    this._actionRCPT(str, callback);
                });
                this._sendCommand('RCPT TO:<' + curRecipient + '>' + this._getDsnRcptToArgs());
            }
        }
    }

    /**
     * Handle response for a RCPT TO: command
     *
     * @param {String} str Message from the server
     */
    _actionRCPT(str, callback) {
        let message,
            err,
            curRecipient = this._recipientQueue.shift();
        if (Number(str.charAt(0)) !== 2) {
            // this is a soft error
            if (this._usingSmtpUtf8 && /^553 /.test(str) && /[\x80-\uFFFF]/.test(curRecipient)) {
                message = 'Internationalized mailbox name not allowed';
            } else {
                message = 'Recipient command failed';
            }
            this._envelope.rejected.push(curRecipient);
            // store error for the failed recipient
            err = this._formatError(message, 'EENVELOPE', str, 'RCPT TO');
            err.recipient = curRecipient;
            this._envelope.rejectedErrors.push(err);
        } else {
            this._envelope.accepted.push(curRecipient);
        }

        if (!this._envelope.rcptQueue.length && !this._recipientQueue.length) {
            if (this._envelope.rejected.length < this._envelope.to.length) {
                this._responseActions.push(str => {
                    this._actionDATA(str, callback);
                });
                this._sendCommand('DATA');
            } else {
                err = this._formatError('Can\x27t send mail - all recipients were rejected', 'EENVELOPE', str, 'RCPT TO');
                err.rejected = this._envelope.rejected;
                err.rejectedErrors = this._envelope.rejectedErrors;
                return callback(err);
            }
        } else if (this._envelope.rcptQueue.length) {
            curRecipient = this._envelope.rcptQueue.shift();
            this._recipientQueue.push(curRecipient);
            this._responseActions.push(str => {
                this._actionRCPT(str, callback);
            });
            this._sendCommand('RCPT TO:<' + curRecipient + '>' + this._getDsnRcptToArgs());
        }
    }

    /**
     * Handle response for a DATA command
     *
     * @param {String} str Message from the server
     */
    _actionDATA(str, callback) {
        // response should be 354 but according to this issue https://github.com/eleith/emailjs/issues/24
        // some servers might use 250 instead, so lets check for 2 or 3 as the first digit
        if (!/^[23]/.test(str)) {
            return callback(this._formatError('Data command failed', 'EENVELOPE', str, 'DATA'));
        }

        let response = {
            accepted: this._envelope.accepted,
            rejected: this._envelope.rejected
        };

        if (this._envelope.rejectedErrors.length) {
            response.rejectedErrors = this._envelope.rejectedErrors;
        }

        callback(null, response);
    }

    /**
     * Handle response for a DATA stream when using SMTP
     * We expect a single response that defines if the sending succeeded or failed
     *
     * @param {String} str Message from the server
     */
    _actionSMTPStream(str, callback) {
        if (Number(str.charAt(0)) !== 2) {
            // Message failed
            return callback(this._formatError('Message failed', 'EMESSAGE', str, 'DATA'));
        } else {
            // Message sent succesfully
            return callback(null, str);
        }
    }

    /**
     * Handle response for a DATA stream
     * We expect a separate response for every recipient. All recipients can either
     * succeed or fail separately
     *
     * @param {String} recipient The recipient this response applies to
     * @param {Boolean} final Is this the final recipient?
     * @param {String} str Message from the server
     */
    _actionLMTPStream(recipient, final, str, callback) {
        let err;
        if (Number(str.charAt(0)) !== 2) {
            // Message failed
            err = this._formatError('Message failed for recipient ' + recipient, 'EMESSAGE', str, 'DATA');
            err.recipient = recipient;
            this._envelope.rejected.push(recipient);
            this._envelope.rejectedErrors.push(err);
            for (let i = 0, len = this._envelope.accepted.length; i < len; i++) {
                if (this._envelope.accepted[i] === recipient) {
                    this._envelope.accepted.splice(i, 1);
                }
            }
        }
        if (final) {
            return callback(null, str);
        }
    }

    _handleXOauth2Token(isRetry, callback) {
        this._auth.oauth2.getToken(isRetry, (err, accessToken) => {
            if (err) {
                this.logger.info(
                    {
                        tnx: 'smtp',
                        username: this._auth.user,
                        action: 'authfail',
                        method: this._authMethod
                    },
                    'User %s failed to authenticate',
                    JSON.stringify(this._auth.user)
                );
                return callback(this._formatError(err, 'EAUTH', false, 'AUTH XOAUTH2'));
            }
            this._responseActions.push(str => {
                this._actionAUTHComplete(str, isRetry, callback);
            });
            this._sendCommand('AUTH XOAUTH2 ' + this._auth.oauth2.buildXOAuth2Token(accessToken));
        });
    }

    /**
     *
     * @param {string} command
     * @private
     */
    _isDestroyedMessage(command) {
        if (this._destroyed) {
            return 'Cannot ' + command + ' - smtp connection is already destroyed.';
        }

        if (this._socket) {
            if (this._socket.destroyed) {
                return 'Cannot ' + command + ' - smtp connection socket is already destroyed.';
            }

            if (!this._socket.writable) {
                return 'Cannot ' + command + ' - smtp connection socket is already half-closed.';
            }
        }
    }

    _getHostname() {
        // defaul hostname is machine hostname or [IP]
        let defaultHostname = os.hostname() || '';

        // ignore if not FQDN
        if (defaultHostname.indexOf('.') < 0) {
            defaultHostname = '[127.0.0.1]';
        }

        // IP should be enclosed in []
        if (defaultHostname.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)) {
            defaultHostname = '[' + defaultHostname + ']';
        }

        return defaultHostname;
    }
}

module.exports = SMTPConnection;


/***/ }),

/***/ 560:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";


const EventEmitter = __webpack_require__(8614);
const PoolResource = __webpack_require__(2230);
const SMTPConnection = __webpack_require__(3559);
const wellKnown = __webpack_require__(6961);
const shared = __webpack_require__(2673);
const packageData = __webpack_require__(7643);

/**
 * Creates a SMTP pool transport object for Nodemailer
 *
 * @constructor
 * @param {Object} options SMTP Connection options
 */
class SMTPPool extends EventEmitter {
    constructor(options) {
        super();

        options = options || {};
        if (typeof options === 'string') {
            options = {
                url: options
            };
        }

        let urlData;
        let service = options.service;

        if (typeof options.getSocket === 'function') {
            this.getSocket = options.getSocket;
        }

        if (options.url) {
            urlData = shared.parseConnectionUrl(options.url);
            service = service || urlData.service;
        }

        this.options = shared.assign(
            false, // create new object
            options, // regular options
            urlData, // url options
            service && wellKnown(service) // wellknown options
        );

        this.options.maxConnections = this.options.maxConnections || 5;
        this.options.maxMessages = this.options.maxMessages || 100;

        this.logger = shared.getLogger(this.options, {
            component: this.options.component || 'smtp-pool'
        });

        // temporary object
        let connection = new SMTPConnection(this.options);

        this.name = 'SMTP (pool)';
        this.version = packageData.version + '[client:' + connection.version + ']';

        this._rateLimit = {
            counter: 0,
            timeout: null,
            waiting: [],
            checkpoint: false,
            delta: Number(this.options.rateDelta) || 1000,
            limit: Number(this.options.rateLimit) || 0
        };
        this._closed = false;
        this._queue = [];
        this._connections = [];
        this._connectionCounter = 0;

        this.idling = true;

        setImmediate(() => {
            if (this.idling) {
                this.emit('idle');
            }
        });
    }

    /**
     * Placeholder function for creating proxy sockets. This method immediatelly returns
     * without a socket
     *
     * @param {Object} options Connection options
     * @param {Function} callback Callback function to run with the socket keys
     */
    getSocket(options, callback) {
        // return immediatelly
        return setImmediate(() => callback(null, false));
    }

    /**
     * Queues an e-mail to be sent using the selected settings
     *
     * @param {Object} mail Mail object
     * @param {Function} callback Callback function
     */
    send(mail, callback) {
        if (this._closed) {
            return false;
        }

        this._queue.push({
            mail,
            requeueAttempts: 0,
            callback
        });

        if (this.idling && this._queue.length >= this.options.maxConnections) {
            this.idling = false;
        }

        setImmediate(() => this._processMessages());

        return true;
    }

    /**
     * Closes all connections in the pool. If there is a message being sent, the connection
     * is closed later
     */
    close() {
        let connection;
        let len = this._connections.length;
        this._closed = true;

        // clear rate limit timer if it exists
        clearTimeout(this._rateLimit.timeout);

        if (!len && !this._queue.length) {
            return;
        }

        // remove all available connections
        for (let i = len - 1; i >= 0; i--) {
            if (this._connections[i] && this._connections[i].available) {
                connection = this._connections[i];
                connection.close();
                this.logger.info(
                    {
                        tnx: 'connection',
                        cid: connection.id,
                        action: 'removed'
                    },
                    'Connection #%s removed',
                    connection.id
                );
            }
        }

        if (len && !this._connections.length) {
            this.logger.debug(
                {
                    tnx: 'connection'
                },
                'All connections removed'
            );
        }

        if (!this._queue.length) {
            return;
        }

        // make sure that entire queue would be cleaned
        let invokeCallbacks = () => {
            if (!this._queue.length) {
                this.logger.debug(
                    {
                        tnx: 'connection'
                    },
                    'Pending queue entries cleared'
                );
                return;
            }
            let entry = this._queue.shift();
            if (entry && typeof entry.callback === 'function') {
                try {
                    entry.callback(new Error('Connection pool was closed'));
                } catch (E) {
                    this.logger.error(
                        {
                            err: E,
                            tnx: 'callback',
                            cid: connection.id
                        },
                        'Callback error for #%s: %s',
                        connection.id,
                        E.message
                    );
                }
            }
            setImmediate(invokeCallbacks);
        };
        setImmediate(invokeCallbacks);
    }

    /**
     * Check the queue and available connections. If there is a message to be sent and there is
     * an available connection, then use this connection to send the mail
     */
    _processMessages() {
        let connection;
        let i, len;

        // do nothing if already closed
        if (this._closed) {
            return;
        }

        // do nothing if queue is empty
        if (!this._queue.length) {
            if (!this.idling) {
                // no pending jobs
                this.idling = true;
                this.emit('idle');
            }
            return;
        }

        // find first available connection
        for (i = 0, len = this._connections.length; i < len; i++) {
            if (this._connections[i].available) {
                connection = this._connections[i];
                break;
            }
        }

        if (!connection && this._connections.length < this.options.maxConnections) {
            connection = this._createConnection();
        }

        if (!connection) {
            // no more free connection slots available
            this.idling = false;
            return;
        }

        // check if there is free space in the processing queue
        if (!this.idling && this._queue.length < this.options.maxConnections) {
            this.idling = true;
            this.emit('idle');
        }

        let entry = (connection.queueEntry = this._queue.shift());
        entry.messageId = (connection.queueEntry.mail.message.getHeader('message-id') || '').replace(/[<>\s]/g, '');

        connection.available = false;

        this.logger.debug(
            {
                tnx: 'pool',
                cid: connection.id,
                messageId: entry.messageId,
                action: 'assign'
            },
            'Assigned message <%s> to #%s (%s)',
            entry.messageId,
            connection.id,
            connection.messages + 1
        );

        if (this._rateLimit.limit) {
            this._rateLimit.counter++;
            if (!this._rateLimit.checkpoint) {
                this._rateLimit.checkpoint = Date.now();
            }
        }

        connection.send(entry.mail, (err, info) => {
            // only process callback if current handler is not changed
            if (entry === connection.queueEntry) {
                try {
                    entry.callback(err, info);
                } catch (E) {
                    this.logger.error(
                        {
                            err: E,
                            tnx: 'callback',
                            cid: connection.id
                        },
                        'Callback error for #%s: %s',
                        connection.id,
                        E.message
                    );
                }
                connection.queueEntry = false;
            }
        });
    }

    /**
     * Creates a new pool resource
     */
    _createConnection() {
        let connection = new PoolResource(this);

        connection.id = ++this._connectionCounter;

        this.logger.info(
            {
                tnx: 'pool',
                cid: connection.id,
                action: 'conection'
            },
            'Created new pool resource #%s',
            connection.id
        );

        // resource comes available
        connection.on('available', () => {
            this.logger.debug(
                {
                    tnx: 'connection',
                    cid: connection.id,
                    action: 'available'
                },
                'Connection #%s became available',
                connection.id
            );

            if (this._closed) {
                // if already closed run close() that will remove this connections from connections list
                this.close();
            } else {
                // check if there's anything else to send
                this._processMessages();
            }
        });

        // resource is terminated with an error
        connection.once('error', err => {
            if (err.code !== 'EMAXLIMIT') {
                this.logger.error(
                    {
                        err,
                        tnx: 'pool',
                        cid: connection.id
                    },
                    'Pool Error for #%s: %s',
                    connection.id,
                    err.message
                );
            } else {
                this.logger.debug(
                    {
                        tnx: 'pool',
                        cid: connection.id,
                        action: 'maxlimit'
                    },
                    'Max messages limit exchausted for #%s',
                    connection.id
                );
            }

            if (connection.queueEntry) {
                try {
                    connection.queueEntry.callback(err);
                } catch (E) {
                    this.logger.error(
                        {
                            err: E,
                            tnx: 'callback',
                            cid: connection.id
                        },
                        'Callback error for #%s: %s',
                        connection.id,
                        E.message
                    );
                }
                connection.queueEntry = false;
            }

            // remove the erroneus connection from connections list
            this._removeConnection(connection);

            this._continueProcessing();
        });

        connection.once('close', () => {
            this.logger.info(
                {
                    tnx: 'connection',
                    cid: connection.id,
                    action: 'closed'
                },
                'Connection #%s was closed',
                connection.id
            );

            this._removeConnection(connection);

            if (connection.queueEntry) {
                // If the connection closed when sending, add the message to the queue again
                // if max number of requeues is not reached yet
                // Note that we must wait a bit.. because the callback of the 'error' handler might be called
                // in the next event loop
                setTimeout(() => {
                    if (connection.queueEntry) {
                        if (this._shouldRequeuOnConnectionClose(connection.queueEntry)) {
                            this._requeueEntryOnConnectionClose(connection);
                        } else {
                            this._failDeliveryOnConnectionClose(connection);
                        }
                    }
                    this._continueProcessing();
                }, 50);
            } else {
                this._continueProcessing();
            }
        });

        this._connections.push(connection);

        return connection;
    }

    _shouldRequeuOnConnectionClose(queueEntry) {
        if (this.options.maxRequeues === undefined || this.options.maxRequeues < 0) {
            return true;
        }

        return queueEntry.requeueAttempts < this.options.maxRequeues;
    }

    _failDeliveryOnConnectionClose(connection) {
        if (connection.queueEntry && connection.queueEntry.callback) {
            try {
                connection.queueEntry.callback(new Error('Reached maximum number of retries after connection was closed'));
            } catch (E) {
                this.logger.error(
                    {
                        err: E,
                        tnx: 'callback',
                        messageId: connection.queueEntry.messageId,
                        cid: connection.id
                    },
                    'Callback error for #%s: %s',
                    connection.id,
                    E.message
                );
            }
            connection.queueEntry = false;
        }
    }

    _requeueEntryOnConnectionClose(connection) {
        connection.queueEntry.requeueAttempts = connection.queueEntry.requeueAttempts + 1;
        this.logger.debug(
            {
                tnx: 'pool',
                cid: connection.id,
                messageId: connection.queueEntry.messageId,
                action: 'requeue'
            },
            'Re-queued message <%s> for #%s. Attempt: #%s',
            connection.queueEntry.messageId,
            connection.id,
            connection.queueEntry.requeueAttempts
        );
        this._queue.unshift(connection.queueEntry);
        connection.queueEntry = false;
    }

    /**
     * Continue to process message if the pool hasn't closed
     */
    _continueProcessing() {
        if (this._closed) {
            this.close();
        } else {
            setTimeout(() => this._processMessages(), 100);
        }
    }

    /**
     * Remove resource from pool
     *
     * @param {Object} connection The PoolResource to remove
     */
    _removeConnection(connection) {
        let index = this._connections.indexOf(connection);

        if (index !== -1) {
            this._connections.splice(index, 1);
        }
    }

    /**
     * Checks if connections have hit current rate limit and if so, queues the availability callback
     *
     * @param {Function} callback Callback function to run once rate limiter has been cleared
     */
    _checkRateLimit(callback) {
        if (!this._rateLimit.limit) {
            return callback();
        }

        let now = Date.now();

        if (this._rateLimit.counter < this._rateLimit.limit) {
            return callback();
        }

        this._rateLimit.waiting.push(callback);

        if (this._rateLimit.checkpoint <= now - this._rateLimit.delta) {
            return this._clearRateLimit();
        } else if (!this._rateLimit.timeout) {
            this._rateLimit.timeout = setTimeout(() => this._clearRateLimit(), this._rateLimit.delta - (now - this._rateLimit.checkpoint));
            this._rateLimit.checkpoint = now;
        }
    }

    /**
     * Clears current rate limit limitation and runs paused callback
     */
    _clearRateLimit() {
        clearTimeout(this._rateLimit.timeout);
        this._rateLimit.timeout = null;
        this._rateLimit.counter = 0;
        this._rateLimit.checkpoint = false;

        // resume all paused connections
        while (this._rateLimit.waiting.length) {
            let cb = this._rateLimit.waiting.shift();
            setImmediate(cb);
        }
    }

    /**
     * Returns true if there are free slots in the queue
     */
    isIdle() {
        return this.idling;
    }

    /**
     * Verifies SMTP configuration
     *
     * @param {Function} callback Callback function
     */
    verify(callback) {
        let promise;

        if (!callback) {
            promise = new Promise((resolve, reject) => {
                callback = shared.callbackPromise(resolve, reject);
            });
        }

        let auth = new PoolResource(this).auth;

        this.getSocket(this.options, (err, socketOptions) => {
            if (err) {
                return callback(err);
            }

            let options = this.options;
            if (socketOptions && socketOptions.connection) {
                this.logger.info(
                    {
                        tnx: 'proxy',
                        remoteAddress: socketOptions.connection.remoteAddress,
                        remotePort: socketOptions.connection.remotePort,
                        destHost: options.host || '',
                        destPort: options.port || '',
                        action: 'connected'
                    },
                    'Using proxied socket from %s:%s to %s:%s',
                    socketOptions.connection.remoteAddress,
                    socketOptions.connection.remotePort,
                    options.host || '',
                    options.port || ''
                );
                options = shared.assign(false, options);
                Object.keys(socketOptions).forEach(key => {
                    options[key] = socketOptions[key];
                });
            }

            let connection = new SMTPConnection(options);
            let returned = false;

            connection.once('error', err => {
                if (returned) {
                    return;
                }
                returned = true;
                connection.close();
                return callback(err);
            });

            connection.once('end', () => {
                if (returned) {
                    return;
                }
                returned = true;
                return callback(new Error('Connection closed'));
            });

            let finalize = () => {
                if (returned) {
                    return;
                }
                returned = true;
                connection.quit();
                return callback(null, true);
            };

            connection.connect(() => {
                if (returned) {
                    return;
                }

                if (auth && (connection.allowsAuth || options.forceAuth)) {
                    connection.login(auth, err => {
                        if (returned) {
                            return;
                        }

                        if (err) {
                            returned = true;
                            connection.close();
                            return callback(err);
                        }

                        finalize();
                    });
                } else {
                    finalize();
                }
            });
        });

        return promise;
    }
}

// expose to the world
module.exports = SMTPPool;


/***/ }),

/***/ 2230:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";


const SMTPConnection = __webpack_require__(3559);
const assign = __webpack_require__(2673).assign;
const XOAuth2 = __webpack_require__(9882);
const EventEmitter = __webpack_require__(8614);

/**
 * Creates an element for the pool
 *
 * @constructor
 * @param {Object} options SMTPPool instance
 */
class PoolResource extends EventEmitter {
    constructor(pool) {
        super();

        this.pool = pool;
        this.options = pool.options;
        this.logger = this.pool.logger;

        if (this.options.auth) {
            switch ((this.options.auth.type || '').toString().toUpperCase()) {
                case 'OAUTH2': {
                    let oauth2 = new XOAuth2(this.options.auth, this.logger);
                    oauth2.provisionCallback = (this.pool.mailer && this.pool.mailer.get('oauth2_provision_cb')) || oauth2.provisionCallback;
                    this.auth = {
                        type: 'OAUTH2',
                        user: this.options.auth.user,
                        oauth2,
                        method: 'XOAUTH2'
                    };
                    oauth2.on('token', token => this.pool.mailer.emit('token', token));
                    oauth2.on('error', err => this.emit('error', err));
                    break;
                }
                default:
                    if (!this.options.auth.user && !this.options.auth.pass) {
                        break;
                    }
                    this.auth = {
                        type: (this.options.auth.type || '').toString().toUpperCase() || 'LOGIN',
                        user: this.options.auth.user,
                        credentials: {
                            user: this.options.auth.user || '',
                            pass: this.options.auth.pass,
                            options: this.options.auth.options
                        },
                        method: (this.options.auth.method || '').trim().toUpperCase() || this.options.authMethod || false
                    };
            }
        }

        this._connection = false;
        this._connected = false;

        this.messages = 0;
        this.available = true;
    }

    /**
     * Initiates a connection to the SMTP server
     *
     * @param {Function} callback Callback function to run once the connection is established or failed
     */
    connect(callback) {
        this.pool.getSocket(this.options, (err, socketOptions) => {
            if (err) {
                return callback(err);
            }

            let returned = false;
            let options = this.options;
            if (socketOptions && socketOptions.connection) {
                this.logger.info(
                    {
                        tnx: 'proxy',
                        remoteAddress: socketOptions.connection.remoteAddress,
                        remotePort: socketOptions.connection.remotePort,
                        destHost: options.host || '',
                        destPort: options.port || '',
                        action: 'connected'
                    },
                    'Using proxied socket from %s:%s to %s:%s',
                    socketOptions.connection.remoteAddress,
                    socketOptions.connection.remotePort,
                    options.host || '',
                    options.port || ''
                );

                options = assign(false, options);
                Object.keys(socketOptions).forEach(key => {
                    options[key] = socketOptions[key];
                });
            }

            this.connection = new SMTPConnection(options);

            this.connection.once('error', err => {
                this.emit('error', err);
                if (returned) {
                    return;
                }
                returned = true;
                return callback(err);
            });

            this.connection.once('end', () => {
                this.close();
                if (returned) {
                    return;
                }
                returned = true;

                let timer = setTimeout(() => {
                    if (returned) {
                        return;
                    }
                    // still have not returned, this means we have an unexpected connection close
                    let err = new Error('Unexpected socket close');
                    if (this.connection && this.connection._socket && this.connection._socket.upgrading) {
                        // starttls connection errors
                        err.code = 'ETLS';
                    }
                    callback(err);
                }, 1000);

                try {
                    timer.unref();
                } catch (E) {
                    // Ignore. Happens on envs with non-node timer implementation
                }
            });

            this.connection.connect(() => {
                if (returned) {
                    return;
                }

                if (this.auth && (this.connection.allowsAuth || options.forceAuth)) {
                    this.connection.login(this.auth, err => {
                        if (returned) {
                            return;
                        }
                        returned = true;

                        if (err) {
                            this.connection.close();
                            this.emit('error', err);
                            return callback(err);
                        }

                        this._connected = true;
                        callback(null, true);
                    });
                } else {
                    returned = true;
                    this._connected = true;
                    return callback(null, true);
                }
            });
        });
    }

    /**
     * Sends an e-mail to be sent using the selected settings
     *
     * @param {Object} mail Mail object
     * @param {Function} callback Callback function
     */
    send(mail, callback) {
        if (!this._connected) {
            return this.connect(err => {
                if (err) {
                    return callback(err);
                }
                return this.send(mail, callback);
            });
        }

        let envelope = mail.message.getEnvelope();
        let messageId = mail.message.messageId();

        let recipients = [].concat(envelope.to || []);
        if (recipients.length > 3) {
            recipients.push('...and ' + recipients.splice(2).length + ' more');
        }
        this.logger.info(
            {
                tnx: 'send',
                messageId,
                cid: this.id
            },
            'Sending message %s using #%s to <%s>',
            messageId,
            this.id,
            recipients.join(', ')
        );

        if (mail.data.dsn) {
            envelope.dsn = mail.data.dsn;
        }

        this.connection.send(envelope, mail.message.createReadStream(), (err, info) => {
            this.messages++;

            if (err) {
                this.connection.close();
                this.emit('error', err);
                return callback(err);
            }

            info.envelope = {
                from: envelope.from,
                to: envelope.to
            };
            info.messageId = messageId;

            setImmediate(() => {
                let err;
                if (this.messages >= this.options.maxMessages) {
                    err = new Error('Resource exhausted');
                    err.code = 'EMAXLIMIT';
                    this.connection.close();
                    this.emit('error', err);
                } else {
                    this.pool._checkRateLimit(() => {
                        this.available = true;
                        this.emit('available');
                    });
                }
            });

            callback(null, info);
        });
    }

    /**
     * Closes the connection
     */
    close() {
        this._connected = false;
        if (this.auth && this.auth.oauth2) {
            this.auth.oauth2.removeAllListeners();
        }
        if (this.connection) {
            this.connection.close();
        }
        this.emit('close');
    }
}

module.exports = PoolResource;


/***/ }),

/***/ 3349:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";


const EventEmitter = __webpack_require__(8614);
const SMTPConnection = __webpack_require__(3559);
const wellKnown = __webpack_require__(6961);
const shared = __webpack_require__(2673);
const XOAuth2 = __webpack_require__(9882);
const packageData = __webpack_require__(7643);

/**
 * Creates a SMTP transport object for Nodemailer
 *
 * @constructor
 * @param {Object} options Connection options
 */
class SMTPTransport extends EventEmitter {
    constructor(options) {
        super();

        options = options || {};
        if (typeof options === 'string') {
            options = {
                url: options
            };
        }

        let urlData;
        let service = options.service;

        if (typeof options.getSocket === 'function') {
            this.getSocket = options.getSocket;
        }

        if (options.url) {
            urlData = shared.parseConnectionUrl(options.url);
            service = service || urlData.service;
        }

        this.options = shared.assign(
            false, // create new object
            options, // regular options
            urlData, // url options
            service && wellKnown(service) // wellknown options
        );

        this.logger = shared.getLogger(this.options, {
            component: this.options.component || 'smtp-transport'
        });

        // temporary object
        let connection = new SMTPConnection(this.options);

        this.name = 'SMTP';
        this.version = packageData.version + '[client:' + connection.version + ']';

        if (this.options.auth) {
            this.auth = this.getAuth({});
        }
    }

    /**
     * Placeholder function for creating proxy sockets. This method immediatelly returns
     * without a socket
     *
     * @param {Object} options Connection options
     * @param {Function} callback Callback function to run with the socket keys
     */
    getSocket(options, callback) {
        // return immediatelly
        return setImmediate(() => callback(null, false));
    }

    getAuth(authOpts) {
        if (!authOpts) {
            return this.auth;
        }

        let hasAuth = false;
        let authData = {};

        if (this.options.auth && typeof this.options.auth === 'object') {
            Object.keys(this.options.auth).forEach(key => {
                hasAuth = true;
                authData[key] = this.options.auth[key];
            });
        }

        if (authOpts && typeof authOpts === 'object') {
            Object.keys(authOpts).forEach(key => {
                hasAuth = true;
                authData[key] = authOpts[key];
            });
        }

        if (!hasAuth) {
            return false;
        }

        switch ((authData.type || '').toString().toUpperCase()) {
            case 'OAUTH2': {
                if (!authData.service && !authData.user) {
                    return false;
                }
                let oauth2 = new XOAuth2(authData, this.logger);
                oauth2.provisionCallback = (this.mailer && this.mailer.get('oauth2_provision_cb')) || oauth2.provisionCallback;
                oauth2.on('token', token => this.mailer.emit('token', token));
                oauth2.on('error', err => this.emit('error', err));
                return {
                    type: 'OAUTH2',
                    user: authData.user,
                    oauth2,
                    method: 'XOAUTH2'
                };
            }
            default:
                return {
                    type: (authData.type || '').toString().toUpperCase() || 'LOGIN',
                    user: authData.user,
                    credentials: {
                        user: authData.user || '',
                        pass: authData.pass,
                        options: authData.options
                    },
                    method: (authData.method || '').trim().toUpperCase() || this.options.authMethod || false
                };
        }
    }

    /**
     * Sends an e-mail using the selected settings
     *
     * @param {Object} mail Mail object
     * @param {Function} callback Callback function
     */
    send(mail, callback) {
        this.getSocket(this.options, (err, socketOptions) => {
            if (err) {
                return callback(err);
            }

            let returned = false;
            let options = this.options;
            if (socketOptions && socketOptions.connection) {
                this.logger.info(
                    {
                        tnx: 'proxy',
                        remoteAddress: socketOptions.connection.remoteAddress,
                        remotePort: socketOptions.connection.remotePort,
                        destHost: options.host || '',
                        destPort: options.port || '',
                        action: 'connected'
                    },
                    'Using proxied socket from %s:%s to %s:%s',
                    socketOptions.connection.remoteAddress,
                    socketOptions.connection.remotePort,
                    options.host || '',
                    options.port || ''
                );

                // only copy options if we need to modify it
                options = shared.assign(false, options);
                Object.keys(socketOptions).forEach(key => {
                    options[key] = socketOptions[key];
                });
            }

            let connection = new SMTPConnection(options);

            connection.once('error', err => {
                if (returned) {
                    return;
                }
                returned = true;
                connection.close();
                return callback(err);
            });

            connection.once('end', () => {
                if (returned) {
                    return;
                }

                let timer = setTimeout(() => {
                    if (returned) {
                        return;
                    }
                    returned = true;
                    // still have not returned, this means we have an unexpected connection close
                    let err = new Error('Unexpected socket close');
                    if (connection && connection._socket && connection._socket.upgrading) {
                        // starttls connection errors
                        err.code = 'ETLS';
                    }
                    callback(err);
                }, 1000);

                try {
                    timer.unref();
                } catch (E) {
                    // Ignore. Happens on envs with non-node timer implementation
                }
            });

            let sendMessage = () => {
                let envelope = mail.message.getEnvelope();
                let messageId = mail.message.messageId();

                let recipients = [].concat(envelope.to || []);
                if (recipients.length > 3) {
                    recipients.push('...and ' + recipients.splice(2).length + ' more');
                }

                if (mail.data.dsn) {
                    envelope.dsn = mail.data.dsn;
                }

                this.logger.info(
                    {
                        tnx: 'send',
                        messageId
                    },
                    'Sending message %s to <%s>',
                    messageId,
                    recipients.join(', ')
                );

                connection.send(envelope, mail.message.createReadStream(), (err, info) => {
                    returned = true;
                    connection.close();
                    if (err) {
                        this.logger.error(
                            {
                                err,
                                tnx: 'send'
                            },
                            'Send error for %s: %s',
                            messageId,
                            err.message
                        );
                        return callback(err);
                    }
                    info.envelope = {
                        from: envelope.from,
                        to: envelope.to
                    };
                    info.messageId = messageId;
                    try {
                        return callback(null, info);
                    } catch (E) {
                        this.logger.error(
                            {
                                err: E,
                                tnx: 'callback'
                            },
                            'Callback error for %s: %s',
                            messageId,
                            E.message
                        );
                    }
                });
            };

            connection.connect(() => {
                if (returned) {
                    return;
                }

                let auth = this.getAuth(mail.data.auth);

                if (auth && (connection.allowsAuth || options.forceAuth)) {
                    connection.login(auth, err => {
                        if (auth && auth !== this.auth && auth.oauth2) {
                            auth.oauth2.removeAllListeners();
                        }
                        if (returned) {
                            return;
                        }

                        if (err) {
                            returned = true;
                            connection.close();
                            return callback(err);
                        }

                        sendMessage();
                    });
                } else {
                    sendMessage();
                }
            });
        });
    }

    /**
     * Verifies SMTP configuration
     *
     * @param {Function} callback Callback function
     */
    verify(callback) {
        let promise;

        if (!callback) {
            promise = new Promise((resolve, reject) => {
                callback = shared.callbackPromise(resolve, reject);
            });
        }

        this.getSocket(this.options, (err, socketOptions) => {
            if (err) {
                return callback(err);
            }

            let options = this.options;
            if (socketOptions && socketOptions.connection) {
                this.logger.info(
                    {
                        tnx: 'proxy',
                        remoteAddress: socketOptions.connection.remoteAddress,
                        remotePort: socketOptions.connection.remotePort,
                        destHost: options.host || '',
                        destPort: options.port || '',
                        action: 'connected'
                    },
                    'Using proxied socket from %s:%s to %s:%s',
                    socketOptions.connection.remoteAddress,
                    socketOptions.connection.remotePort,
                    options.host || '',
                    options.port || ''
                );

                options = shared.assign(false, options);
                Object.keys(socketOptions).forEach(key => {
                    options[key] = socketOptions[key];
                });
            }

            let connection = new SMTPConnection(options);
            let returned = false;

            connection.once('error', err => {
                if (returned) {
                    return;
                }
                returned = true;
                connection.close();
                return callback(err);
            });

            connection.once('end', () => {
                if (returned) {
                    return;
                }
                returned = true;
                return callback(new Error('Connection closed'));
            });

            let finalize = () => {
                if (returned) {
                    return;
                }
                returned = true;
                connection.quit();
                return callback(null, true);
            };

            connection.connect(() => {
                if (returned) {
                    return;
                }

                let authData = this.getAuth({});

                if (authData && (connection.allowsAuth || options.forceAuth)) {
                    connection.login(authData, err => {
                        if (returned) {
                            return;
                        }

                        if (err) {
                            returned = true;
                            connection.close();
                            return callback(err);
                        }

                        finalize();
                    });
                } else {
                    finalize();
                }
            });
        });

        return promise;
    }

    /**
     * Releases resources
     */
    close() {
        if (this.auth && this.auth.oauth2) {
            this.auth.oauth2.removeAllListeners();
        }
        this.emit('close');
    }
}

// expose to the world
module.exports = SMTPTransport;


/***/ }),

/***/ 1888:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";


const packageData = __webpack_require__(7643);
const shared = __webpack_require__(2673);
const LeWindows = __webpack_require__(741);
const LeUnix = __webpack_require__(7754);

/**
 * Generates a Transport object for streaming
 *
 * Possible options can be the following:
 *
 *  * **buffer** if true, then returns the message as a Buffer object instead of a stream
 *  * **newline** either 'windows' or 'unix'
 *
 * @constructor
 * @param {Object} optional config parameter
 */
class StreamTransport {
    constructor(options) {
        options = options || {};

        this.options = options || {};

        this.name = 'StreamTransport';
        this.version = packageData.version;

        this.logger = shared.getLogger(this.options, {
            component: this.options.component || 'stream-transport'
        });

        this.winbreak = ['win', 'windows', 'dos', '\r\n'].includes((options.newline || '').toString().toLowerCase());
    }

    /**
     * Compiles a mailcomposer message and forwards it to handler that sends it
     *
     * @param {Object} emailMessage MailComposer object
     * @param {Function} callback Callback function to run when the sending is completed
     */
    send(mail, done) {
        // We probably need this in the output
        mail.message.keepBcc = true;

        let envelope = mail.data.envelope || mail.message.getEnvelope();
        let messageId = mail.message.messageId();

        let recipients = [].concat(envelope.to || []);
        if (recipients.length > 3) {
            recipients.push('...and ' + recipients.splice(2).length + ' more');
        }
        this.logger.info(
            {
                tnx: 'send',
                messageId
            },
            'Sending message %s to <%s> using %s line breaks',
            messageId,
            recipients.join(', '),
            this.winbreak ? '<CR><LF>' : '<LF>'
        );

        setImmediate(() => {
            let sourceStream;
            let stream;
            let transform;

            try {
                transform = this.winbreak ? new LeWindows() : new LeUnix();
                sourceStream = mail.message.createReadStream();
                stream = sourceStream.pipe(transform);
                sourceStream.on('error', err => stream.emit('error', err));
            } catch (E) {
                this.logger.error(
                    {
                        err: E,
                        tnx: 'send',
                        messageId
                    },
                    'Creating send stream failed for %s. %s',
                    messageId,
                    E.message
                );
                return done(E);
            }

            if (!this.options.buffer) {
                stream.once('error', err => {
                    this.logger.error(
                        {
                            err,
                            tnx: 'send',
                            messageId
                        },
                        'Failed creating message for %s. %s',
                        messageId,
                        err.message
                    );
                });
                return done(null, {
                    envelope: mail.data.envelope || mail.message.getEnvelope(),
                    messageId,
                    message: stream
                });
            }

            let chunks = [];
            let chunklen = 0;
            stream.on('readable', () => {
                let chunk;
                while ((chunk = stream.read()) !== null) {
                    chunks.push(chunk);
                    chunklen += chunk.length;
                }
            });

            stream.once('error', err => {
                this.logger.error(
                    {
                        err,
                        tnx: 'send',
                        messageId
                    },
                    'Failed creating message for %s. %s',
                    messageId,
                    err.message
                );
                return done(err);
            });

            stream.on('end', () =>
                done(null, {
                    envelope: mail.data.envelope || mail.message.getEnvelope(),
                    messageId,
                    message: Buffer.concat(chunks, chunklen)
                })
            );
        });
    }
}

module.exports = StreamTransport;


/***/ }),

/***/ 6961:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";


const services = __webpack_require__(1913);
const normalized = {};

Object.keys(services).forEach(key => {
    let service = services[key];

    normalized[normalizeKey(key)] = normalizeService(service);

    [].concat(service.aliases || []).forEach(alias => {
        normalized[normalizeKey(alias)] = normalizeService(service);
    });

    [].concat(service.domains || []).forEach(domain => {
        normalized[normalizeKey(domain)] = normalizeService(service);
    });
});

function normalizeKey(key) {
    return key.replace(/[^a-zA-Z0-9.-]/g, '').toLowerCase();
}

function normalizeService(service) {
    let filter = ['domains', 'aliases'];
    let response = {};

    Object.keys(service).forEach(key => {
        if (filter.indexOf(key) < 0) {
            response[key] = service[key];
        }
    });

    return response;
}

/**
 * Resolves SMTP config for given key. Key can be a name (like 'Gmail'), alias (like 'Google Mail') or
 * an email address (like 'test@googlemail.com').
 *
 * @param {String} key [description]
 * @returns {Object} SMTP config or false if not found
 */
module.exports = function(key) {
    key = normalizeKey(key.split('@').pop());
    return normalized[key] || false;
};


/***/ }),

/***/ 9882:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

"use strict";


const Stream = __webpack_require__(2413).Stream;
const fetch = __webpack_require__(9106);
const crypto = __webpack_require__(6417);
const shared = __webpack_require__(2673);

/**
 * XOAUTH2 access_token generator for Gmail.
 * Create client ID for web applications in Google API console to use it.
 * See Offline Access for receiving the needed refreshToken for an user
 * https://developers.google.com/accounts/docs/OAuth2WebServer#offline
 *
 * Usage for generating access tokens with a custom method using provisionCallback:
 * provisionCallback(user, renew, callback)
 *   * user is the username to get the token for
 *   * renew is a boolean that if true indicates that existing token failed and needs to be renewed
 *   * callback is the callback to run with (error, accessToken [, expires])
 *     * accessToken is a string
 *     * expires is an optional expire time in milliseconds
 * If provisionCallback is used, then Nodemailer does not try to attempt generating the token by itself
 *
 * @constructor
 * @param {Object} options Client information for token generation
 * @param {String} options.user User e-mail address
 * @param {String} options.clientId Client ID value
 * @param {String} options.clientSecret Client secret value
 * @param {String} options.refreshToken Refresh token for an user
 * @param {String} options.accessUrl Endpoint for token generation, defaults to 'https://accounts.google.com/o/oauth2/token'
 * @param {String} options.accessToken An existing valid accessToken
 * @param {String} options.privateKey Private key for JSW
 * @param {Number} options.expires Optional Access Token expire time in ms
 * @param {Number} options.timeout Optional TTL for Access Token in seconds
 * @param {Function} options.provisionCallback Function to run when a new access token is required
 */
class XOAuth2 extends Stream {
    constructor(options, logger) {
        super();

        this.options = options || {};

        if (options && options.serviceClient) {
            if (!options.privateKey || !options.user) {
                setImmediate(() => this.emit('error', new Error('Options "privateKey" and "user" are required for service account!')));
                return;
            }

            let serviceRequestTimeout = Math.min(Math.max(Number(this.options.serviceRequestTimeout) || 0, 0), 3600);
            this.options.serviceRequestTimeout = serviceRequestTimeout || 5 * 60;
        }

        this.logger = shared.getLogger(
            {
                logger
            },
            {
                component: this.options.component || 'OAuth2'
            }
        );

        this.provisionCallback = typeof this.options.provisionCallback === 'function' ? this.options.provisionCallback : false;

        this.options.accessUrl = this.options.accessUrl || 'https://accounts.google.com/o/oauth2/token';
        this.options.customHeaders = this.options.customHeaders || {};
        this.options.customParams = this.options.customParams || {};

        this.accessToken = this.options.accessToken || false;

        if (this.options.expires && Number(this.options.expires)) {
            this.expires = this.options.expires;
        } else {
            let timeout = Math.max(Number(this.options.timeout) || 0, 0);
            this.expires = (timeout && Date.now() + timeout * 1000) || 0;
        }
    }

    /**
     * Returns or generates (if previous has expired) a XOAuth2 token
     *
     * @param {Boolean} renew If false then use cached access token (if available)
     * @param {Function} callback Callback function with error object and token string
     */
    getToken(renew, callback) {
        if (!renew && this.accessToken && (!this.expires || this.expires > Date.now())) {
            return callback(null, this.accessToken);
        }

        let generateCallback = (...args) => {
            if (args[0]) {
                this.logger.error(
                    {
                        err: args[0],
                        tnx: 'OAUTH2',
                        user: this.options.user,
                        action: 'renew'
                    },
                    'Failed generating new Access Token for %s',
                    this.options.user
                );
            } else {
                this.logger.info(
                    {
                        tnx: 'OAUTH2',
                        user: this.options.user,
                        action: 'renew'
                    },
                    'Generated new Access Token for %s',
                    this.options.user
                );
            }
            callback(...args);
        };

        if (this.provisionCallback) {
            this.provisionCallback(this.options.user, !!renew, (err, accessToken, expires) => {
                if (!err && accessToken) {
                    this.accessToken = accessToken;
                    this.expires = expires || 0;
                }
                generateCallback(err, accessToken);
            });
        } else {
            this.generateToken(generateCallback);
        }
    }

    /**
     * Updates token values
     *
     * @param {String} accessToken New access token
     * @param {Number} timeout Access token lifetime in seconds
     *
     * Emits 'token': { user: User email-address, accessToken: the new accessToken, timeout: TTL in seconds}
     */
    updateToken(accessToken, timeout) {
        this.accessToken = accessToken;
        timeout = Math.max(Number(timeout) || 0, 0);
        this.expires = (timeout && Date.now() + timeout * 1000) || 0;

        this.emit('token', {
            user: this.options.user,
            accessToken: accessToken || '',
            expires: this.expires
        });
    }

    /**
     * Generates a new XOAuth2 token with the credentials provided at initialization
     *
     * @param {Function} callback Callback function with error object and token string
     */
    generateToken(callback) {
        let urlOptions;
        let loggedUrlOptions;
        if (this.options.serviceClient) {
            // service account - https://developers.google.com/identity/protocols/OAuth2ServiceAccount
            let iat = Math.floor(Date.now() / 1000); // unix time
            let tokenData = {
                iss: this.options.serviceClient,
                scope: this.options.scope || 'https://mail.google.com/',
                sub: this.options.user,
                aud: this.options.accessUrl,
                iat,
                exp: iat + this.options.serviceRequestTimeout
            };
            let token;
            try {
                token = this.jwtSignRS256(tokenData);
            } catch (err) {
                return callback(new Error('Can\x27t generate token. Check your auth options'));
            }

            urlOptions = {
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion: token
            };

            loggedUrlOptions = {
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion: tokenData
            };
        } else {
            if (!this.options.refreshToken) {
                return callback(new Error('Can\x27t create new access token for user'));
            }

            // web app - https://developers.google.com/identity/protocols/OAuth2WebServer
            urlOptions = {
                client_id: this.options.clientId || '',
                client_secret: this.options.clientSecret || '',
                refresh_token: this.options.refreshToken,
                grant_type: 'refresh_token'
            };

            loggedUrlOptions = {
                client_id: this.options.clientId || '',
                client_secret: (this.options.clientSecret || '').substr(0, 6) + '...',
                refresh_token: (this.options.refreshToken || '').substr(0, 6) + '...',
                grant_type: 'refresh_token'
            };
        }

        Object.keys(this.options.customParams).forEach(key => {
            urlOptions[key] = this.options.customParams[key];
            loggedUrlOptions[key] = this.options.customParams[key];
        });

        this.logger.debug(
            {
                tnx: 'OAUTH2',
                user: this.options.user,
                action: 'generate'
            },
            'Requesting token using: %s',
            JSON.stringify(loggedUrlOptions)
        );

        this.postRequest(this.options.accessUrl, urlOptions, this.options, (error, body) => {
            let data;

            if (error) {
                return callback(error);
            }

            try {
                data = JSON.parse(body.toString());
            } catch (E) {
                return callback(E);
            }

            if (!data || typeof data !== 'object') {
                this.logger.debug(
                    {
                        tnx: 'OAUTH2',
                        user: this.options.user,
                        action: 'post'
                    },
                    'Response: %s',
                    (body || '').toString()
                );
                return callback(new Error('Invalid authentication response'));
            }

            let logData = {};
            Object.keys(data).forEach(key => {
                if (key !== 'access_token') {
                    logData[key] = data[key];
                } else {
                    logData[key] = (data[key] || '').toString().substr(0, 6) + '...';
                }
            });

            this.logger.debug(
                {
                    tnx: 'OAUTH2',
                    user: this.options.user,
                    action: 'post'
                },
                'Response: %s',
                JSON.stringify(logData)
            );

            if (data.error) {
                return callback(new Error(data.error));
            }

            if (data.access_token) {
                this.updateToken(data.access_token, data.expires_in);
                return callback(null, this.accessToken);
            }

            return callback(new Error('No access token'));
        });
    }

    /**
     * Converts an access_token and user id into a base64 encoded XOAuth2 token
     *
     * @param {String} [accessToken] Access token string
     * @return {String} Base64 encoded token for IMAP or SMTP login
     */
    buildXOAuth2Token(accessToken) {
        let authData = ['user=' + (this.options.user || ''), 'auth=Bearer ' + (accessToken || this.accessToken), '', ''];
        return Buffer.from(authData.join('\x01'), 'utf-8').toString('base64');
    }

    /**
     * Custom POST request handler.
     * This is only needed to keep paths short in Windows ??? usually this module
     * is a dependency of a dependency and if it tries to require something
     * like the request module the paths get way too long to handle for Windows.
     * As we do only a simple POST request we do not actually require complicated
     * logic support (no redirects, no nothing) anyway.
     *
     * @param {String} url Url to POST to
     * @param {String|Buffer} payload Payload to POST
     * @param {Function} callback Callback function with (err, buff)
     */
    postRequest(url, payload, params, callback) {
        let returned = false;

        let chunks = [];
        let chunklen = 0;

        let req = fetch(url, {
            method: 'post',
            headers: params.customHeaders,
            body: payload,
            allowErrorResponse: true
        });

        req.on('readable', () => {
            let chunk;
            while ((chunk = req.read()) !== null) {
                chunks.push(chunk);
                chunklen += chunk.length;
            }
        });

        req.once('error', err => {
            if (returned) {
                return;
            }
            returned = true;
            return callback(err);
        });

        req.once('end', () => {
            if (returned) {
                return;
            }
            returned = true;
            return callback(null, Buffer.concat(chunks, chunklen));
        });
    }

    /**
     * Encodes a buffer or a string into Base64url format
     *
     * @param {Buffer|String} data The data to convert
     * @return {String} The encoded string
     */
    toBase64URL(data) {
        if (typeof data === 'string') {
            data = Buffer.from(data);
        }

        return data
            .toString('base64')
            .replace(/[=]+/g, '') // remove '='s
            .replace(/\+/g, '-') // '+' ??? '-'
            .replace(/\//g, '_'); // '/' ??? '_'
    }

    /**
     * Creates a JSON Web Token signed with RS256 (SHA256 + RSA)
     *
     * @param {Object} payload The payload to include in the generated token
     * @return {String} The generated and signed token
     */
    jwtSignRS256(payload) {
        payload = ['{"alg":"RS256","typ":"JWT"}', JSON.stringify(payload)].map(val => this.toBase64URL(val)).join('.');
        let signature = crypto.createSign('RSA-SHA256').update(payload).sign(this.options.privateKey);
        return payload + '.' + this.toBase64URL(signature);
    }
}

module.exports = XOAuth2;


/***/ }),

/***/ 1223:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

var wrappy = __webpack_require__(2940)
module.exports = wrappy(once)
module.exports.strict = wrappy(onceStrict)

once.proto = once(function () {
  Object.defineProperty(Function.prototype, 'once', {
    value: function () {
      return once(this)
    },
    configurable: true
  })

  Object.defineProperty(Function.prototype, 'onceStrict', {
    value: function () {
      return onceStrict(this)
    },
    configurable: true
  })
})

function once (fn) {
  var f = function () {
    if (f.called) return f.value
    f.called = true
    return f.value = fn.apply(this, arguments)
  }
  f.called = false
  return f
}

function onceStrict (fn) {
  var f = function () {
    if (f.called)
      throw new Error(f.onceError)
    f.called = true
    return f.value = fn.apply(this, arguments)
  }
  var name = fn.name || 'Function wrapped with `once`'
  f.onceError = name + " shouldn't be called more than once"
  f.called = false
  return f
}


/***/ }),

/***/ 4294:
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

module.exports = __webpack_require__(4219);


/***/ }),

/***/ 4219:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

"use strict";


var net = __webpack_require__(1631);
var tls = __webpack_require__(4016);
var http = __webpack_require__(8605);
var https = __webpack_require__(7211);
var events = __webpack_require__(8614);
var assert = __webpack_require__(2357);
var util = __webpack_require__(1669);


exports.httpOverHttp = httpOverHttp;
exports.httpsOverHttp = httpsOverHttp;
exports.httpOverHttps = httpOverHttps;
exports.httpsOverHttps = httpsOverHttps;


function httpOverHttp(options) {
  var agent = new TunnelingAgent(options);
  agent.request = http.request;
  return agent;
}

function httpsOverHttp(options) {
  var agent = new TunnelingAgent(options);
  agent.request = http.request;
  agent.createSocket = createSecureSocket;
  agent.defaultPort = 443;
  return agent;
}

function httpOverHttps(options) {
  var agent = new TunnelingAgent(options);
  agent.request = https.request;
  return agent;
}

function httpsOverHttps(options) {
  var agent = new TunnelingAgent(options);
  agent.request = https.request;
  agent.createSocket = createSecureSocket;
  agent.defaultPort = 443;
  return agent;
}


function TunnelingAgent(options) {
  var self = this;
  self.options = options || {};
  self.proxyOptions = self.options.proxy || {};
  self.maxSockets = self.options.maxSockets || http.Agent.defaultMaxSockets;
  self.requests = [];
  self.sockets = [];

  self.on('free', function onFree(socket, host, port, localAddress) {
    var options = toOptions(host, port, localAddress);
    for (var i = 0, len = self.requests.length; i < len; ++i) {
      var pending = self.requests[i];
      if (pending.host === options.host && pending.port === options.port) {
        // Detect the request to connect same origin server,
        // reuse the connection.
        self.requests.splice(i, 1);
        pending.request.onSocket(socket);
        return;
      }
    }
    socket.destroy();
    self.removeSocket(socket);
  });
}
util.inherits(TunnelingAgent, events.EventEmitter);

TunnelingAgent.prototype.addRequest = function addRequest(req, host, port, localAddress) {
  var self = this;
  var options = mergeOptions({request: req}, self.options, toOptions(host, port, localAddress));

  if (self.sockets.length >= this.maxSockets) {
    // We are over limit so we'll add it to the queue.
    self.requests.push(options);
    return;
  }

  // If we are under maxSockets create a new one.
  self.createSocket(options, function(socket) {
    socket.on('free', onFree);
    socket.on('close', onCloseOrRemove);
    socket.on('agentRemove', onCloseOrRemove);
    req.onSocket(socket);

    function onFree() {
      self.emit('free', socket, options);
    }

    function onCloseOrRemove(err) {
      self.removeSocket(socket);
      socket.removeListener('free', onFree);
      socket.removeListener('close', onCloseOrRemove);
      socket.removeListener('agentRemove', onCloseOrRemove);
    }
  });
};

TunnelingAgent.prototype.createSocket = function createSocket(options, cb) {
  var self = this;
  var placeholder = {};
  self.sockets.push(placeholder);

  var connectOptions = mergeOptions({}, self.proxyOptions, {
    method: 'CONNECT',
    path: options.host + ':' + options.port,
    agent: false,
    headers: {
      host: options.host + ':' + options.port
    }
  });
  if (options.localAddress) {
    connectOptions.localAddress = options.localAddress;
  }
  if (connectOptions.proxyAuth) {
    connectOptions.headers = connectOptions.headers || {};
    connectOptions.headers['Proxy-Authorization'] = 'Basic ' +
        new Buffer(connectOptions.proxyAuth).toString('base64');
  }

  debug('making CONNECT request');
  var connectReq = self.request(connectOptions);
  connectReq.useChunkedEncodingByDefault = false; // for v0.6
  connectReq.once('response', onResponse); // for v0.6
  connectReq.once('upgrade', onUpgrade);   // for v0.6
  connectReq.once('connect', onConnect);   // for v0.7 or later
  connectReq.once('error', onError);
  connectReq.end();

  function onResponse(res) {
    // Very hacky. This is necessary to avoid http-parser leaks.
    res.upgrade = true;
  }

  function onUpgrade(res, socket, head) {
    // Hacky.
    process.nextTick(function() {
      onConnect(res, socket, head);
    });
  }

  function onConnect(res, socket, head) {
    connectReq.removeAllListeners();
    socket.removeAllListeners();

    if (res.statusCode !== 200) {
      debug('tunneling socket could not be established, statusCode=%d',
        res.statusCode);
      socket.destroy();
      var error = new Error('tunneling socket could not be established, ' +
        'statusCode=' + res.statusCode);
      error.code = 'ECONNRESET';
      options.request.emit('error', error);
      self.removeSocket(placeholder);
      return;
    }
    if (head.length > 0) {
      debug('got illegal response body from proxy');
      socket.destroy();
      var error = new Error('got illegal response body from proxy');
      error.code = 'ECONNRESET';
      options.request.emit('error', error);
      self.removeSocket(placeholder);
      return;
    }
    debug('tunneling connection has established');
    self.sockets[self.sockets.indexOf(placeholder)] = socket;
    return cb(socket);
  }

  function onError(cause) {
    connectReq.removeAllListeners();

    debug('tunneling socket could not be established, cause=%s\n',
          cause.message, cause.stack);
    var error = new Error('tunneling socket could not be established, ' +
                          'cause=' + cause.message);
    error.code = 'ECONNRESET';
    options.request.emit('error', error);
    self.removeSocket(placeholder);
  }
};

TunnelingAgent.prototype.removeSocket = function removeSocket(socket) {
  var pos = this.sockets.indexOf(socket)
  if (pos === -1) {
    return;
  }
  this.sockets.splice(pos, 1);

  var pending = this.requests.shift();
  if (pending) {
    // If we have pending requests and a socket gets closed a new one
    // needs to be created to take over in the pool for the one that closed.
    this.createSocket(pending, function(socket) {
      pending.request.onSocket(socket);
    });
  }
};

function createSecureSocket(options, cb) {
  var self = this;
  TunnelingAgent.prototype.createSocket.call(self, options, function(socket) {
    var hostHeader = options.request.getHeader('host');
    var tlsOptions = mergeOptions({}, self.options, {
      socket: socket,
      servername: hostHeader ? hostHeader.replace(/:.*$/, '') : options.host
    });

    // 0 is dummy port for v0.6
    var secureSocket = tls.connect(0, tlsOptions);
    self.sockets[self.sockets.indexOf(socket)] = secureSocket;
    cb(secureSocket);
  });
}


function toOptions(host, port, localAddress) {
  if (typeof host === 'string') { // since v0.10
    return {
      host: host,
      port: port,
      localAddress: localAddress
    };
  }
  return host; // for v0.11 or later
}

function mergeOptions(target) {
  for (var i = 1, len = arguments.length; i < len; ++i) {
    var overrides = arguments[i];
    if (typeof overrides === 'object') {
      var keys = Object.keys(overrides);
      for (var j = 0, keyLen = keys.length; j < keyLen; ++j) {
        var k = keys[j];
        if (overrides[k] !== undefined) {
          target[k] = overrides[k];
        }
      }
    }
  }
  return target;
}


var debug;
if (process.env.NODE_DEBUG && /\btunnel\b/.test(process.env.NODE_DEBUG)) {
  debug = function() {
    var args = Array.prototype.slice.call(arguments);
    if (typeof args[0] === 'string') {
      args[0] = 'TUNNEL: ' + args[0];
    } else {
      args.unshift('TUNNEL:');
    }
    console.error.apply(console, args);
  }
} else {
  debug = function() {};
}
exports.debug = debug; // for test


/***/ }),

/***/ 5030:
/***/ ((__unused_webpack_module, exports) => {

"use strict";


Object.defineProperty(exports, "__esModule", ({ value: true }));

function getUserAgent() {
  if (typeof navigator === "object" && "userAgent" in navigator) {
    return navigator.userAgent;
  }

  if (typeof process === "object" && "version" in process) {
    return `Node.js/${process.version.substr(1)} (${process.platform}; ${process.arch})`;
  }

  return "<environment undetectable>";
}

exports.getUserAgent = getUserAgent;
//# sourceMappingURL=index.js.map


/***/ }),

/***/ 2940:
/***/ ((module) => {

// Returns a wrapper function that returns a wrapped callback
// The wrapper function should do some stuff, and return a
// presumably different callback function.
// This makes sure that own properties are retained, so that
// decorations and such are not lost along the way.
module.exports = wrappy
function wrappy (fn, cb) {
  if (fn && cb) return wrappy(fn)(cb)

  if (typeof fn !== 'function')
    throw new TypeError('need wrapper function')

  Object.keys(fn).forEach(function (k) {
    wrapper[k] = fn[k]
  })

  return wrapper

  function wrapper() {
    var args = new Array(arguments.length)
    for (var i = 0; i < args.length; i++) {
      args[i] = arguments[i]
    }
    var ret = fn.apply(this, args)
    var cb = args[args.length-1]
    if (typeof ret === 'function' && ret !== cb) {
      Object.keys(cb).forEach(function (k) {
        ret[k] = cb[k]
      })
    }
    return ret
  }
}


/***/ }),

/***/ 2877:
/***/ ((module) => {

module.exports = eval("require")("encoding");


/***/ }),

/***/ 1913:
/***/ ((module) => {

"use strict";
module.exports = JSON.parse("{\"126\":{\"host\":\"smtp.126.com\",\"port\":465,\"secure\":true},\"163\":{\"host\":\"smtp.163.com\",\"port\":465,\"secure\":true},\"1und1\":{\"host\":\"smtp.1und1.de\",\"port\":465,\"secure\":true,\"authMethod\":\"LOGIN\"},\"AOL\":{\"domains\":[\"aol.com\"],\"host\":\"smtp.aol.com\",\"port\":587},\"DebugMail\":{\"host\":\"debugmail.io\",\"port\":25},\"DynectEmail\":{\"aliases\":[\"Dynect\"],\"host\":\"smtp.dynect.net\",\"port\":25},\"FastMail\":{\"domains\":[\"fastmail.fm\"],\"host\":\"smtp.fastmail.com\",\"port\":465,\"secure\":true},\"GandiMail\":{\"aliases\":[\"Gandi\",\"Gandi Mail\"],\"host\":\"mail.gandi.net\",\"port\":587},\"Gmail\":{\"aliases\":[\"Google Mail\"],\"domains\":[\"gmail.com\",\"googlemail.com\"],\"host\":\"smtp.gmail.com\",\"port\":465,\"secure\":true},\"Godaddy\":{\"host\":\"smtpout.secureserver.net\",\"port\":25},\"GodaddyAsia\":{\"host\":\"smtp.asia.secureserver.net\",\"port\":25},\"GodaddyEurope\":{\"host\":\"smtp.europe.secureserver.net\",\"port\":25},\"hot.ee\":{\"host\":\"mail.hot.ee\"},\"Hotmail\":{\"aliases\":[\"Outlook\",\"Outlook.com\",\"Hotmail.com\"],\"domains\":[\"hotmail.com\",\"outlook.com\"],\"host\":\"smtp.live.com\",\"port\":587},\"iCloud\":{\"aliases\":[\"Me\",\"Mac\"],\"domains\":[\"me.com\",\"mac.com\"],\"host\":\"smtp.mail.me.com\",\"port\":587},\"mail.ee\":{\"host\":\"smtp.mail.ee\"},\"Mail.ru\":{\"host\":\"smtp.mail.ru\",\"port\":465,\"secure\":true},\"Maildev\":{\"port\":1025,\"ignoreTLS\":true},\"Mailgun\":{\"host\":\"smtp.mailgun.org\",\"port\":465,\"secure\":true},\"Mailjet\":{\"host\":\"in.mailjet.com\",\"port\":587},\"Mailosaur\":{\"host\":\"mailosaur.io\",\"port\":25},\"Mailtrap\":{\"host\":\"smtp.mailtrap.io\",\"port\":2525},\"Mandrill\":{\"host\":\"smtp.mandrillapp.com\",\"port\":587},\"Naver\":{\"host\":\"smtp.naver.com\",\"port\":587},\"One\":{\"host\":\"send.one.com\",\"port\":465,\"secure\":true},\"OpenMailBox\":{\"aliases\":[\"OMB\",\"openmailbox.org\"],\"host\":\"smtp.openmailbox.org\",\"port\":465,\"secure\":true},\"Outlook365\":{\"host\":\"smtp.office365.com\",\"port\":587,\"secure\":false},\"Postmark\":{\"aliases\":[\"PostmarkApp\"],\"host\":\"smtp.postmarkapp.com\",\"port\":2525},\"qiye.aliyun\":{\"host\":\"smtp.mxhichina.com\",\"port\":\"465\",\"secure\":true},\"QQ\":{\"domains\":[\"qq.com\"],\"host\":\"smtp.qq.com\",\"port\":465,\"secure\":true},\"QQex\":{\"aliases\":[\"QQ Enterprise\"],\"domains\":[\"exmail.qq.com\"],\"host\":\"smtp.exmail.qq.com\",\"port\":465,\"secure\":true},\"SendCloud\":{\"host\":\"smtpcloud.sohu.com\",\"port\":25},\"SendGrid\":{\"host\":\"smtp.sendgrid.net\",\"port\":587},\"SendinBlue\":{\"host\":\"smtp-relay.sendinblue.com\",\"port\":587},\"SendPulse\":{\"host\":\"smtp-pulse.com\",\"port\":465,\"secure\":true},\"SES\":{\"host\":\"email-smtp.us-east-1.amazonaws.com\",\"port\":465,\"secure\":true},\"SES-US-EAST-1\":{\"host\":\"email-smtp.us-east-1.amazonaws.com\",\"port\":465,\"secure\":true},\"SES-US-WEST-2\":{\"host\":\"email-smtp.us-west-2.amazonaws.com\",\"port\":465,\"secure\":true},\"SES-EU-WEST-1\":{\"host\":\"email-smtp.eu-west-1.amazonaws.com\",\"port\":465,\"secure\":true},\"Sparkpost\":{\"aliases\":[\"SparkPost\",\"SparkPost Mail\"],\"domains\":[\"sparkpost.com\"],\"host\":\"smtp.sparkpostmail.com\",\"port\":587,\"secure\":false},\"Tipimail\":{\"host\":\"smtp.tipimail.com\",\"port\":587},\"Yahoo\":{\"domains\":[\"yahoo.com\"],\"host\":\"smtp.mail.yahoo.com\",\"port\":465,\"secure\":true},\"Yandex\":{\"domains\":[\"yandex.ru\"],\"host\":\"smtp.yandex.ru\",\"port\":465,\"secure\":true},\"Zoho\":{\"host\":\"smtp.zoho.com\",\"port\":465,\"secure\":true,\"authMethod\":\"LOGIN\"}}");

/***/ }),

/***/ 7643:
/***/ ((module) => {

"use strict";
module.exports = JSON.parse("{\"_from\":\"nodemailer\",\"_id\":\"nodemailer@6.4.11\",\"_inBundle\":false,\"_integrity\":\"sha512-BVZBDi+aJV4O38rxsUh164Dk1NCqgh6Cm0rQSb9SK/DHGll/DrCMnycVDD7msJgZCnmVa8ASo8EZzR7jsgTukQ==\",\"_location\":\"/nodemailer\",\"_phantomChildren\":{},\"_requested\":{\"type\":\"tag\",\"registry\":true,\"raw\":\"nodemailer\",\"name\":\"nodemailer\",\"escapedName\":\"nodemailer\",\"rawSpec\":\"\",\"saveSpec\":null,\"fetchSpec\":\"latest\"},\"_requiredBy\":[\"#USER\",\"/\"],\"_resolved\":\"https://registry.npmjs.org/nodemailer/-/nodemailer-6.4.11.tgz\",\"_shasum\":\"1f00b4ffd106403f17c03f3d43d5945b2677046c\",\"_spec\":\"nodemailer\",\"_where\":\"/Users/andrewgray/Documents/GitHub/project-activity\",\"author\":{\"name\":\"Andris Reinman\"},\"bugs\":{\"url\":\"https://github.com/nodemailer/nodemailer/issues\"},\"bundleDependencies\":false,\"dependencies\":{},\"deprecated\":false,\"description\":\"Easy as cake e-mail sending from your Node.js applications\",\"devDependencies\":{\"bunyan\":\"1.8.14\",\"chai\":\"4.2.0\",\"eslint-config-nodemailer\":\"1.2.0\",\"eslint-config-prettier\":\"6.11.0\",\"grunt\":\"1.2.1\",\"grunt-cli\":\"1.3.2\",\"grunt-eslint\":\"23.0.0\",\"grunt-mocha-test\":\"0.13.3\",\"libbase64\":\"1.2.1\",\"libmime\":\"5.0.0\",\"libqp\":\"1.1.0\",\"mocha\":\"8.0.1\",\"nodemailer-ntlm-auth\":\"1.0.1\",\"proxy\":\"1.0.2\",\"proxy-test-server\":\"1.0.0\",\"sinon\":\"9.0.2\",\"smtp-server\":\"3.7.0\"},\"engines\":{\"node\":\">=6.0.0\"},\"homepage\":\"https://nodemailer.com/\",\"keywords\":[\"Nodemailer\"],\"license\":\"MIT\",\"main\":\"lib/nodemailer.js\",\"name\":\"nodemailer\",\"repository\":{\"type\":\"git\",\"url\":\"git+https://github.com/nodemailer/nodemailer.git\"},\"scripts\":{\"postinstall\":\"node -e \\\"try{require('./postinstall')}catch(e){}\\\"\",\"test\":\"grunt\"},\"version\":\"6.4.11\"}");

/***/ }),

/***/ 2357:
/***/ ((module) => {

"use strict";
module.exports = require("assert");

/***/ }),

/***/ 3129:
/***/ ((module) => {

"use strict";
module.exports = require("child_process");

/***/ }),

/***/ 6417:
/***/ ((module) => {

"use strict";
module.exports = require("crypto");

/***/ }),

/***/ 881:
/***/ ((module) => {

"use strict";
module.exports = require("dns");

/***/ }),

/***/ 8614:
/***/ ((module) => {

"use strict";
module.exports = require("events");

/***/ }),

/***/ 5747:
/***/ ((module) => {

"use strict";
module.exports = require("fs");

/***/ }),

/***/ 8605:
/***/ ((module) => {

"use strict";
module.exports = require("http");

/***/ }),

/***/ 7211:
/***/ ((module) => {

"use strict";
module.exports = require("https");

/***/ }),

/***/ 1631:
/***/ ((module) => {

"use strict";
module.exports = require("net");

/***/ }),

/***/ 2087:
/***/ ((module) => {

"use strict";
module.exports = require("os");

/***/ }),

/***/ 5622:
/***/ ((module) => {

"use strict";
module.exports = require("path");

/***/ }),

/***/ 4213:
/***/ ((module) => {

"use strict";
module.exports = require("punycode");

/***/ }),

/***/ 2413:
/***/ ((module) => {

"use strict";
module.exports = require("stream");

/***/ }),

/***/ 4016:
/***/ ((module) => {

"use strict";
module.exports = require("tls");

/***/ }),

/***/ 8835:
/***/ ((module) => {

"use strict";
module.exports = require("url");

/***/ }),

/***/ 1669:
/***/ ((module) => {

"use strict";
module.exports = require("util");

/***/ }),

/***/ 8761:
/***/ ((module) => {

"use strict";
module.exports = require("zlib");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		if(__webpack_module_cache__[moduleId]) {
/******/ 			return __webpack_module_cache__[moduleId].exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	__webpack_require__.ab = __dirname + "/";/************************************************************************/
/******/ 	// module exports must be returned from runtime so entry inlining is disabled
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(2932);
/******/ })()
;