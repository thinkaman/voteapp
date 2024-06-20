/*jshint esversion: 11 */

const DEFAULT_CANDIDATE_COUNT = 4;
const CANDIDATE_RADIUS = 16;

import { PERFECTION_PENALTY } from './votesim_common.js';
import { MAX_CANDIDATES } from './votesim_common.js';
import { label } from './votesim_common.js';
import { list2labels } from './votesim_common.js';
import { list2labelPairs } from './votesim_common.js';
import { rankArray2string } from './votesim_common.js';

import {reseed} from './votesim_common.js';
import {loadSeed} from './votesim_common.js';
import {getSeedString} from './votesim_common.js';

import {methodList} from './votesim_common.js';
import {expandDict} from './votesim_common.js';
import {isMethodIDPartisan} from './votesim_common.js';
import {isMethodIDLowTurnout} from './votesim_common.js';
import {isMethodIDCardinal} from './votesim_common.js';
import {isMethodIDElimination} from './votesim_common.js';
import {isMethodIDCondorcet} from './votesim_common.js';

import {generateVoterData} from './votesim_common.js';
import {generateCandidateData} from './votesim_common.js';

import {measureVoterDistancesAll} from './votesim_common.js';
import {measureVoterDistance} from './votesim_common.js';
import {calculateVoterRanks} from './votesim_common.js';
import {applyDispo} from './votesim_common.js';

import {SankeyChart} from './sankey_chart.js';

if (navigator.userAgent.match(/firefox|fxios/i)) {
	let match = window.navigator.userAgent.match(/Firefox\/([0-9]+)\./);
	let ver = match ? parseInt(match[1]) : 0;
	if (ver < 111) {
		document.body.innerHTML = "Firefox versions prior to 111 do not support module workers; please update your browser.";
	} else {
		alert("WARNING: Firefox is now supported but requires dom.workers.modules.enabled set to TRUE in about:config");
	}
}

let margin = {top: 10, right: 40, bottom: 30, left: 30},
	width = 650 - margin.left - margin.right,
	height = 650 - margin.top - margin.bottom;

let xScale = d3.scaleLinear()
	.domain([-5,5])
	.range([0,width]);
let yScale = d3.scaleLinear()
	.domain([-5, 5])
	.range([height, 0]);

let triggerTabList = [].slice.call(document.querySelectorAll('#specialViewTabContent a'));
triggerTabList.forEach(function (triggerEl) {
	let tabTrigger = new bootstrap.Tab(triggerEl);

	triggerEl.addEventListener('click', function (event) {
		event.preventDefault();
		tabTrigger.show();
	});
});

document.querySelector("#main_chart").addEventListener('contextmenu', (e) => { e.preventDefault();});

const urlParams = new URLSearchParams(window.location.search);

let isSimRunning = false;
let currentElectorateGenCategory = "Normal";
let currentCandidateGenCategory = "Uniform";
let currentlySelectedSankeyMethod = methodList.indexOf("Hare (IRV)");

if (urlParams.has('election')) {
	let s = urlParams.get('election');
	currentElectorateGenCategory = s[0];
	loadSeed(s.slice(1));
} else {
	reseed();
}

function getURL() {
	let url = window.location.href.split('?')[0];
	url += "?election=" + currentElectorateGenCategory[0] + getSeedString();
	url += "&candidates=";
	for (let c1 = 0; c1 < candidateCount; c1++) {
		url += Math.round(xScale(candidate_data[c1][0])).toString() + ",";
		url += Math.round(yScale(candidate_data[c1][1])).toString() + ",";
		url += candidate_data[c1][4].toString() + ((c1 == candidateCount - 1) ? "" : ",");
	}
	return url;
}
function copyURLToClipboard() {
	navigator.clipboard.writeText(getURL());
	updateInfoTooltip(["Link successfully copied to clipboard"]);
}
document.querySelector("#return_button").addEventListener("click", returnToDefaultMode)
d3.select("#return_button").on('mouseover', e => displayInfoTooltip(e,
		[isHeatmapActive ? "Remove Spoiler Heatmap" : "Return to single election visualizer"]))
	.on('mouseout', clearInfoTooltip);
document.querySelector("#link_button").addEventListener("click", copyURLToClipboard)
d3.select("#link_button")
	.on('mouseover', e => displayInfoTooltip(e,
		["Copy URL for this election to clipboard to share"]))
	.on('mouseout', clearInfoTooltip);
d3.select("#help_button").on('mouseover', e => displayInfoTooltip(e,
		["Get Help (TODO)"]))
	.on('mouseout', clearInfoTooltip);



function openTab(tabID) {
	d3.selectAll('.main-tab')
		.classed("active", null)
		.attr("aria-selected", false);
	d3.selectAll('.tab-pane')
		.classed("show", null)
		.classed("active", null);
	d3.select('#' + tabID)
		.classed("active", true)
		.attr("aria-selected", true);
	d3.select('#' + tabID + "_content")
		.classed("show", true)
		.classed("active", true);
}

let candidateRightClickMenu = [
	{
		title: 'Hide/Unhide',
		action: function(elm, d) { elm[5] ? unhideCandidate(elm[3]) : hideCandidate(elm[3]); }
	}];

let isHeatmapActive = false;
let isCandidateGenFirst = true;
let candidate_data, voter_data;
let candidateCount = DEFAULT_CANDIDATE_COUNT;
window.vd = function(i) {return voter_data[i];};
window.cd = function(i) {return candidate_data[i];};

let condorcetLine1 = "The candidate who beats every other candidate (1v1) wins.";
let methodStrData = {
	"PartyPlurality": {  "title": "Plurality Partisan Primary",
	                     "aka": "AKA: Garbage",
	                     "stringList": ["The candidate on the left with the most first-place votes (among just the voters on the left) and the candidate on the right with the most first-place votes (among just the voters on the right) have a runoff.",
						  "(If the right or left side has no candidates, we run a normal Plurality election.)",
	                     "WARNING: This is not a single election method!  It requires running two elections!"]},
	"PartyHare": {       "title": "Hare-IRV Partisan Primary",
	                     "aka": "AKA: Instant-Runoff Partisan Primary",
	                     "stringList": ["The candidate who wins a Hare IRV election on the left (among just the voters on the left) and who wins a Hare IRV election on the right (among just the voters on the right) have a runoff.",
						  "(If the right or left side has no candidates, we run a normal Hare IRV election.)",
	                     "WARNING: This is not a single election method!  It requires running two elections!"],
						 "sankey": "Hare: Eliminating candidate with the fewest first-place votes. (Only one party/side shown)"},
	"PartyApproval": {   "title": "Approval Partisan Primary",
	                     "aka": null,
	                     "stringList": ["The candidate on the left with the most approvals (among just the voters on the left) and the candidate on the right with the most approvals (among just the voters on the right) have a runoff.",
						  "(If the right or left side has no candidates, we run a normal Approval election.)",
	                     "WARNING: This is not a single election method!  It requires running two elections!"]},
	"PartyMinimax": {    "title": "Minimax Partisan Primary",
	                     "aka": "AKA: Condorcet Primary",
	                     "stringList": ["The candidate on the left with the most first-place votes (among just the voters on the left) and the candidate on the right with the most first-place votes (among just the voters on the right) have a runoff.",
						  "(If the right or left side has no candidates, we run a normal Minimax election.)",
	                     "WARNING: This is not a single election method!  It requires running two elections!"]},
	"LT-PartyPlurality": { "title": "Low-Turnout Plurality Partisan Primary",
	                     "aka": "AKA: Extra-Garbage",
	                     "stringList": ["The candidate on the left with the most first-place votes (among just a *subset* of voters on the left side, slightly biased to more leftward-voters) and the candidate on the right with the most first-place votes (similarly selected from the right side) have a runoff.",
						  "(If the right or left side has no candidates, we run a normal Plurality election.)",
	                     "WARNING: This is not a single election method!  It requires running two elections!"]},
	"LT-PartyHare": {       "title": "Low-Turnout Hare-IRV Partisan Primary",
	                     "aka": "AKA: Instant-Runoff Partisan Primary",
	                     "stringList": ["The candidate who wins a Hare IRV election on the left (among just a *subset* of voters on the left side, slightly biased to more leftward-voters) and who wins a Hare IRV election on the right (similarly selected from the right side) have a runoff.",
						  "(If the right or left side has no candidates, we run a normal Hare IRV election.)",
	                     "WARNING: This is not a single election method!  It requires running two elections!"],
						 "sankey": "Hare: Eliminating candidate with the fewest first-place votes. (Only one party/side shown)"},
	"LT-PartyApproval": {   "title": "Low-Turnout Approval Partisan Primary",
	                     "aka": null,
	                     "stringList": ["The candidate on the left with the most approvals (among just a *subset* of voters on the left side, slightly biased to more leftward-voters) and the candidate on the right with the most approvals (similarly selected from the right side) have a runoff.",
						  "(If the right or left side has no candidates, we run a normal Approval election.)",
	                     "WARNING: This is not a single election method!  It requires running two elections!"]},
	"LT-PartyMinimax": {    "title": "Low-Turnout Minimax Partisan Primary",
	                     "aka": "AKA: Condorcet Primary",
	                     "stringList": ["The candidate on the left with the most first-place votes (among just a *subset* of voters on the left side, slightly biased to more leftward-voters) and the candidate on the right with the most first-place votes (similarly selected from the right side) have a runoff.",
						  "(If the right or left side has no candidates, we run a normal Minimax election.)",
	                     "WARNING: This is not a single election method!  It requires running two elections!"]},
	"Plurality": {       "title": "Plurality",
	                     "aka": "AKA: First-Past-The-Post (FPTP)",
	                     "stringList": ["The candidate with the most first-place votes wins. All other votes are ignored."]},
	"Dowdall": {         "title": "Dowdall Count",
	                     "aka": null,
	                     "stringList": ["Candidates receive points for how high they rank on each ballot, such as 1 for 1st, 1/2 for 2nd, 1/3 for 3rd and so on. The candidate with the most points wins."]},
	"Borda": {           "title": "Borda Count",
	                     "aka": null,
	                     "stringList": ["Candidates receive points for how high they rank on each ballot, such as 10 for 1st, 9 for 2nd, 8 for 3rd and so on. The candidate with the most points wins."]},
	"AntiPlurality":   { "title": "Anti-Plurality",
	                     "aka": null,
	                     "stringList": ["The candidate with the fewest last-place votes wins. All other votes are ignored.",
						  "Note that this measure is especially prone to ties, so a tiebreaker of having the least first-place votes (least-hated by virtue of \"most overlooked\") is also used.",
						  "Also note that Anti-Plurality is especially vulnerable to multi-target strategies, beyond the single-target strategies tested here. Assume that all candidates without a true majority are fully vulnerable to strategy with this method."]},
	"Top2Runoff": {      "title": "Top 2 Runoff",
	                     "aka": "AKA: Contingent Vote",
	                     "stringList": ["If no candidate has a majority of first-place votes, another election is held between just the two who got the most first-place votes.",
	                     "WARNING: This is not a single election method!  It requires running two elections!  (Attempting to do it automatically, an instant-runoff limited to two rounds, is known as a Contingent Vote)"]},
	"Hare (IRV)": {      "title": "Hare's Method",
	                     "aka": "AKA: Instant-Runoff (IRV), \"Ranked Choice Voting\" (RCV)",
	                     "stringList": ["If no candidate has a majority of the first-place vote, the candidate with the fewest first-place votes is eliminated from consideration and the votes are counted again. Supporters of the eliminated candidate now have their next-place vote considered.",
	                     "Note that while this method is often called \"Ranked Choice Voting\", almost every method listed here uses ranked ballots."],
						 "sankey": "Hare: Eliminating candidate with the fewest first-place votes."},
	"Contingency": {      "title": "Contingency Voting",
	                     "aka": "AKA: Alternative Vote (AV), Back-Up Choice, Majority Voting",
	                     "stringList": ["If no candidate has a majority of the first-place vote, the candidate with the fewest first-place votes is eliminated from consideration and the votes are counted again. Supporters of the eliminated candidate now have their second-place vote considered--but no additional places beyond second are allowed."],
						 "sankey": "Contingency: Eliminating candidate with the fewest first-place votes, but only allowing second-place votes moving forward."},
	"Coombs":          { "title": "Coombs' Method",
	                     "aka": "AKA: Inverted Instant-Runoff",
	                     "stringList": ["If no candidate has a majority of the first-place vote, the candidate with the most last-place votes is eliminated from consideration and the votes are counted again. Supporters of the eliminated candidate now have their next-place vote considered."],
						 "sankey": "Coombs: Eliminating candidate with the most last-place votes."},
						 
	"RawRange":       { "title": "Range (Non-Normalized)",
	                     "aka": "AKA: Score",
	                     "stringList": ["The candidate with the best total score from rated ballots wins.",
	                     "Here all voters rate candidates in a total vacuum, purely according to linear distance; no attempt is made to give their favorite the best-possible score nor their least-favorite a worst-possible score, even if this would mean giving all candidates almost the same vote.",
						 "(Note that on sample ballots displayed here, raw score is reported as pure distance--so lower is better.)"]},
	"NormalRange":     { "title": "Range (Normalized)",
	                     "aka": "AKA: Score",
	                     "stringList": ["The candidate with the highest total score from rated ballots wins.",
	                     "Here all voters normalize their votes (or had them automatically normalized for them) to give their favorite the maximum score and their least-favorite a minimum score. Scores of candidates in-between are scaled according to their Disposition."]},
						 
	"ItNormRange":     { "title": "Range (Iterative-Normalized)",
	                     "aka": null,
	                     "stringList": ["The candidate with the lowest total score from rated ballots is eliminated from consideration. Each ballot is re-normalized, and the votes are counted again until only the highest-scoring winner is left.",
	                     "Here all voters normalize their votes (or had them automatically normalized for them) to give their favorite the maximum score and their least-favorite a minimum score. Scores of candidates in-between are scaled according to their Disposition, and then re-normalized after each elimination."],
						 "sankey": "Iterated Range: Eliminating candidate with the lowest total score. Ballots are re-normalized each round."},
						 
	"Approval":        { "title": "Approval",
	                     "aka": "AKA: Score",
	                     "stringList": ["The candidate with the most approval votes wins.",
						 "Here all voters normalize their votes to always approve their favorite and not-approve their least-favorite. Approvals of candidates in-between are scaled according to their Disposition."]},
	"Median":          { "title": "Highest Median",
	                     "aka": "AKA: Majority Judgement",
	                     "stringList": ["The candidate with the highest median score across rated ballots wins.",
	                     "Here all voters normalize their votes (or had them automatically normalized for them) to give their favorite the maximum score and their least-favorite a minimum score. Scores of candidates in-between are scaled according to their Disposition, and then re-normalized after each elimination.",
	                     "(While the original Majority Judgement proposals stipulated voting with words, here we use normalized numerical scores like any other.)"]},
	"V321":            { "title": "3-2-1 Voting",
	                     "aka": null,
	                     "stringList": ["The three candidates with most approval votes from rated ballots are the semi-finalists. The two semi-finalists with least rejection votes are the finalists. Whichever finalist voters prefer over the other wins.",
	                     "Here all voters normalize their votes to always approve their favorite and reject their least-favorite. Approvals of candidates in-between are scaled according to their Disposition.",
						 "For computational simplicity, in this abridged simulation voters only reject their least-favorite candidate or the target of a strategy."]},
	"ApprovalRunoff":  { "title": "Approval into Top 2 Runoff",
	                     "aka": null,
	                     "stringList": ["The two candidates with the most approval votes are the finalists. Another election is held between the finalists.",
	                     "Here all voters normalize their votes to always approve their favorite and not-approve their least-favorite. Approvals of candidates in-between are scaled according to their Disposition.",
	                     "Note that strategies tested here only involve compromise and bury tactics against a single target; effective strategies against cardinal runoff voting usually involve two targets, attempting to seize control of both finalist spots. (However difficult that may be)",
	                     "WARNING: This is not a single election method!  It requires running two elections!"]},
	"STAR":            { "title": "STAR Voting",
	                     "aka": "Score-Then-Automatic-Runoff",
	                     "stringList": ["The two candidates with the highest total scores from rated ballots are the finalists. Whichever finalist voters prefer over the other wins.",
	                     "Here all voters normalize their votes (or had them automatically normalized for them) to give their favorite the maximum score and their least-favorite a minimum score. Scores of candidates in-between are scaled according to their Disposition.",
	                     "Note that strategies tested here only involve compromise and bury tactics against a single target; effective strategies against cardinal runoff voting usually involve two targets, attempting to seize control of both finalist spots. (However difficult that may be)"]},
	"STAR3":           { "title": "STAR Voting (3-way Runoff)",
	                     "aka": "Score-Then-Automatic-Runoff",
	                     "stringList": ["The three candidates with the highest total scores from rated ballots are the finalists. Whichever finalist beats both the others 1-on-1 wins. (If there is a tie, the smallest margin victory is ignored.)",
	                     "Here all voters normalize their votes (or had them automatically normalized for them) to give their favorite the maximum score and their least-favorite a minimum score. Scores of candidates in-between are scaled according to their Disposition."]},
	"Condorcet//Plurality":     { "title": "Condorcet//Plurality",
	                     "aka": null,
	                     "stringList": [condorcetLine1,
	                     "If there is a tie somehow, the candidate with the most first-place votes wins. (Even if they were not part of the tie!)"]},
	"Smith//Plurality":     { "title": "Smith//Plurality",
	                     "aka": null,
	                     "stringList": [condorcetLine1,
	                     "If there is a tie somehow, the tied candidate with the most first-place votes wins."]},
	"Landau//Plurality": { "title": "Landau//Plurality",
	                     "aka": null,
	                     "stringList": [condorcetLine1,
	                     "If there is a tie somehow, the tied candidate with the most first-place votes wins. Candidates who perform strictly worse than another against all opponents are not considered among the tie."]},
	"RCIPE":           { "title": "",
	                     "aka": "Condorcet-Loser//Hare-IRV",
	                     "stringList": ["All candidates are compared, and the one who loses the most (or has the least first-place votes if tied) is eliminated until one candidate remains."],
	                     "sankey": "Pairwise Elimination: Eliminating candidate who loses to all others, or who has the least first-place votes (shown) if tied."},
	"IPE":           { "title": "Instant Pairwise Elimination",
	                     "aka": "Condorcet-Loser//Baldwin",
	                     "stringList": ["All candidates are compared, and the one who loses the most (or has the lowest Borda score if tied) is eliminated until one candidate remains."],
	                     "sankey": "Pairwise Elimination: Eliminating candidate who loses to all others, or who has lowest Borda score (shown) if tied."},
	"BTR":           { "title": "Bottom-Two Runoff",
	                     "aka": "BTR-IRV",
	                     "stringList": ["The bottom two candidates by first-rank votes are compared (and the loser between them eliminated) until one candidate remains."],
	                     "sankey": "Bottom-Two Runoff: Eliminating loser between the two candidates with the fewest first-place votes."},
	"Smith//Dowdall":       { "title": "Smith//Dowdall",
	                     "aka": null,
	                     "stringList": [condorcetLine1,
	                     "If there is a tie somehow, the tied candidate with the highest Dowdall Count wins. (1 point for 1st place vote, 1/2 for 2nd, 1/3 for 3rd, etc.)"]},
	"Black":         { "title": "Black's Method",
	                     "aka": "AKA: Condorcet-Borda, Smith-Borda",
	                     "stringList": [condorcetLine1,
	                     "If there is a tie somehow, the tied candidate with the highest Borda Count wins. (10 points for 1st place vote, 9 for 2nd, 8 for 3rd, etc.)"]},
	"Smith//AntiPlurality": { "title": "Smith//AntiPlurality",
	                     "aka": "AKA: Condorcet-AntiPlurality",
	                     "stringList": [condorcetLine1,
	                     "If there is a tie somehow, the tied candidate with the fewest last-place votes wins."]},
	"Condorcet//Hare":          { "title": "Naive Condorcet-Hare",
	                     "aka": "AKA: Condorcet//IRV",
	                     "stringList": [condorcetLine1,
	                     "If there is a tie somehow, the candidate with the fewest first-place voters are eliminated and the votes are counted again.",
						 "(This includes ALL candidates, not just the ones tied, and procedes until there is a majority.  It is possible a candidate outside the initial tie wins.)"],
						 "sankey": "Hare: Eliminating candidate with the fewest first-place votes."},
	"Smith//Hare":      { "title": "Smith-Hare",
	                     "aka": "AKA: Smith//IRV, Smith-AV",
	                     "stringList": [condorcetLine1,
	                     "If there is a tie somehow, the tied candidate with the fewest first-place voters are eliminated and the votes are counted again.",
						 "(This includes only the tied candidates.)"],
						 "sankey": "Hare: Eliminating candidate with the fewest first-place votes. Only considers tied candidates."},
	"TidemanAlt":    { "title": "Tideman's Alternative",
	                     "aka": "Condorcet-based IRV",
	                     "stringList": [condorcetLine1,
	                     "If there is a tie somehow, the tied candidate with the fewest first-place voters are eliminated and the votes are counted again.",
						 "(This includes only the tied candidates, and stops when the tie is broken.)"],
					     "sankey": "Hare: Eliminating candidate with the fewest first-place votes. Only considers tied candidates, and ends when cycle is broken."},
	"Landau//Hare": { "title": "Landau//Hare",
	                     "aka": "Condorcet-based IRV",
	                     "stringList": [condorcetLine1,
	                     "If there is a tie somehow, the tied candidate with the fewest first-place voters are eliminated and the votes are counted again.",
						 "(This includes only the tied candidates. Candidates who perform strictly worse than another against all opponents are not considered among the tie.)"],
					     "sankey": "Hare: Eliminating candidate with the fewest first-place votes. Only considers tied candidates, and ends when cycle is broken."},
	"LandauTidemanAlt": { "title": "Tideman's Alternative (Landau)",
	                     "aka": "Condorcet-based IRV",
	                     "stringList": [condorcetLine1,
	                     "If there is a tie somehow, the tied candidate with the fewest first-place voters are eliminated and the votes are counted again.",
						 "(This includes only the tied candidates, and stops when the tie is broken. Candidates who perform strictly worse than another against all opponents are not considered among the tie.)"],
					     "sankey": "Hare: Eliminating candidate with the fewest first-place votes. Only considers tied candidates, and ends when cycle is broken."},
	"Benham":        { "title": "Benham's Method",
	                     "aka": "Condorcet-based IRV",
	                     "stringList": [condorcetLine1,						 
	                     "If there is a tie somehow, the candidate with the fewest first-place voters are eliminated and the votes are counted again.",
						 "(This includes ALL candidates, and stops when the tie is broken.)"],
						 "sankey": "Hare: Eliminating candidate with the fewest first-place votes. Ends when cycle is broken."},
	"Woodall":       { "title": "Woodall's Method",
	                     "aka": "Condorcet-based IRV",
	                     "stringList": [condorcetLine1,
	                     "If there is a tie somehow, the candidate with the fewest first-place voters are eliminated and the votes are counted again.",
						 "(This includes ALL candidates; although the full elimination process is carried out, only the original tied candidates are elgible to win.)"],
						 "sankey": "Hare: Eliminating candidate with the fewest first-place votes. Ends when one original cycle member remains."},
	"Smith//Dowdall": {  "title": "Smith//Dowdall",
	                     "aka": "AKA: Dowdall-Instant-Runoff",
	                     "stringList": [condorcetLine1,
	                     "If there is a tie somehow, the tied candidate with the lowest Dowdall Count (1 point for 1st place vote, 1/2 for 2nd, 1/3 for 3rd, etc.) is eliminated and the votes are counted again."],
						 "sankey": "New: Eliminating candidate with the lowest Dowdall Count. Only considers tied candidates, and ends when cycle is broken."},
	"Baldwin": {        "title": "Baldwin's Method",
	                     "aka": "AKA: Borda-Instant-Runoff",
	                     "stringList": [condorcetLine1,
	                     "If there is a tie somehow, the tied candidate with the lowest Borda Count (10 points for 1st place vote, 9 for 2nd, 8 for 3rd, etc.) is eliminated and the votes are counted again."],
						 "sankey": "Baldwin: Eliminating candidate with the lowest Borda Count. Only considers tied candidates, and ends when cycle is broken."},
	"Smith//Coombs": {        "title": "Smith//Coombs",
	                     "aka": "AKA: Condorcet-Coombs",
	                     "stringList": [condorcetLine1,
	                     "If there is a tie somehow, the tied candidate with the most last-place voters are eliminated and the votes are counted again."],
						 "sankey": "Coombs: Eliminating candidate with the most last-place votes. Only considers tied candidates, and ends when cycle is broken."},
						 
	"Smith//RawRange":     { "title": "Smith//Score (Non-Normalized)",
	                     "aka": "AKA: Condorcet-Score, Smith-Score",
	                     "stringList": [condorcetLine1,
	                     "If there is a tie somehow, the candidate with the best total score from rated ballots wins.",
	                     "Here all voters rate candidates in a total vacuum, purely according to linear distance; no attempt is made to give their favorite the best-possible score nor their least-favorite a worst-possible score, even if this would mean giving all candidates almost the same vote." ]},
	"Smith//Score":   { "title": "Smith//Score (Normalized)",
	                     "aka": "AKA: Smith//NormalRange, Condorcet-Score",
	                     "stringList": [condorcetLine1,
	                     "If there is a tie somehow, the candidate with the highest total score from rated ballots wins.",
	                     "Here all voters normalize their votes (or had them automatically normalized for them) to give their favorite the maximum score and their least-favorite a minimum score. Scores of candidates in-between are scaled according to their Disposition. Votes are re-normalized after a tie!"]},
						 
	"Smith//ItNormRange":   { "title": "Smith//Range (Iterative-Normalized)",
	                     "aka": null,
	                     "stringList": [condorcetLine1,
	                     "If there is a tie somehow, the candidate with the lowest total score from rated ballots is eliminated from consideration. Each ballot is re-normalized, and the votes are counted again until only the highest-scoring winner is left.",
	                     "Here all voters normalize their votes (or had them automatically normalized for them) to give their favorite the maximum score and their least-favorite a minimum score. Scores of candidates in-between are scaled according to their Disposition, and then re-normalized after each elimination."],
	                     "sankey": "Iterated Range: Eliminating candidate with the lowest total score. Re-normalized each round until tie cycle is broken."},
						 
	"Smith//Approval":      { "title": "Smith//Approval",
	                     "aka": "AKA: Condorcet-Approval",
	                     "stringList": [condorcetLine1,
	                     "If there is a tie somehow, the candidate with the most approval votes wins.",
						 "Here all voters normalize their votes to always approve their favorite and not-approve their least-favorite. Approvals of candidates in-between are scaled according to their Disposition. Votes are re-normalized after a tie!",
						 "Note that this requires voters fill out a ballot with both rankings and approvals."]},
						 
	"Smith//Median":        { "title": "Smith//Median",
	                     "aka": "AKA: Condorcet-Approval",
	                     "stringList": [condorcetLine1,
	                     "If there is a tie somehow, the candidate with the highest median score across rated ballots wins.",
						 "Here all voters normalize their votes (or had them automatically normalized for them) to give their favorite the maximum score and their least-favorite a minimum score. Scores of candidates in-between are scaled according to their Disposition. Votes are re-normalized after a tie!"]},

	"Smith//321":          { "title": "Smith//3-2-1 Voting",
	                     "aka": null,
	                     "stringList": [condorcetLine1,
	                     "If there is a tie somehow, the three candidates with most approval votes from rated ballots are the semi-finalists. The two semi-finalists with least rejection votes are the finalists. Whichever finalist voters prefer over the other wins.",
	                     "Here all voters normalize their votes to always approve their favorite and reject their least-favorite. Approvals of candidates in-between are scaled according to their Disposition. Votes are re-normalized after a tie!",
						 "For computational simplicity, this is an abridged simulation where voters only reject their least-favorite candidate or the target of a strategy."]},
	"Smith//STAR":          { "title": "Smith//STAR",
	                     "aka": "AKA: Condorcet-STAR",
	                     "stringList": [condorcetLine1,
	                     "If there is a tie somehow, the two candidates with the highest total scores from rated ballots are the finalists. Whichever finalist voters prefer over the other wins.",
	                     "Here all voters normalize their votes (or had them automatically normalized for them) to give their favorite the maximum score and their least-favorite a minimum score. Scores of candidates in-between are scaled according to their Disposition. Votes are re-normalized after a tie!",
	                     "Note that strategies tested here only involve compromise and bury tactics against a single target; effective strategies against STAR voting usually involve two targets, attempting to seize control of both finalist spots. (However difficult that may be)"]},
						 
	"Minimax":       { "title": "Minimax",
	                     "aka": "AKA: Minimax Pairwise-Margins",
	                     "stringList": [condorcetLine1,
	                     "If there is a tie somehow, it is broken by ignoring the weakest-margin victory between candidates. This includes ALL candidates, not just the ones tied."]},
	"RankedPairs":   { "title": "Ranked Pairs",
	                     "aka": "AKA: Tideman's Method",
	                     "stringList": [condorcetLine1,
	                     "If there is a tie somehow, it is broken by ignoring the weakest-margin victory between candidates. In a wide tie, the \"weakest-margin victory\" is specifically the one that contradicts the strongest-margin victories."]},
	"StableVoting":  { "title": "Stable Voting",
	                     "aka": "AKA: Iterative Ranked Pairs",
	                     "stringList": [condorcetLine1,
	                     "If there is a tie somehow, it is broken by ignoring the weakest-margin victory between candidates. In a wide tie, the \"weakest-margin victory\" is specifically the one that would first contradict a recursive algorithm enumerating the results."]},
	"Schulze":       { "title": "Schulze Method",
	                     "aka": "AKA: Beatpath",
	                     "stringList": [condorcetLine1,
	                     "If there is a tie somehow, it is broken by ignoring the weakest-margin victory between candidates. In a wide tie, the \"weakest-margin victory\" is specifically the one that is part of the weakest \"beatpath\" over other candidates."]},
	"RangeMinimax":  { "title": "Minimax (Rated)",
	                     "aka": "AKA: Normalized Cardinal Pairwise",
	                     "stringList": [condorcetLine1,
	                     "If there is a tie somehow, it is broken by ignoring the weakest-margin victory between candidates according to total score from rated ballots.",
						 "Here all voters normalize their votes (or had them automatically normalized for them) to give their favorite the maximum score and their least-favorite a minimum score. Scores of candidates in-between are scaled according to their Disposition. Votes are re-normalized after a tie!"]}
};
const SANKEY_CONDORCET_STRING = "There is already an absolute winner; no elimination needed.";
const SANKEY_INVALID_STRING = "Mouseover a method that eliminates & reassesses candidates.";

function generateElectorate(category = "Normal", num = 10000) {
	if (category == "Load") {
			if      (currentElectorateGenCategory == "N") { category = "Normal"; }
			else if (currentElectorateGenCategory == "O") { category = "One"; }
			else if (currentElectorateGenCategory == "P") { category = "Polarized"; }
			else if (currentElectorateGenCategory == "C") { category = "Clustered"; }
			else if (currentElectorateGenCategory == "F") { category = "Fan"; }
			else                                          { category = "Normal"; }
	} else {
		currentElectorateGenCategory = category;
		reseed();
	}
	voter_data = generateVoterData(category, num);
}
generateElectorate("Load");

function generateCandidates(category = "Uniform") {	
	candidate_data = generateCandidateData(category, candidateCount, currentElectorateGenCategory, candidate_data, voter_data);
	candidateCount = candidate_data.length;
}
generateCandidates();

if (urlParams.has('candidates')) {
	let canList = urlParams.get('candidates').split(',').map(parseFloat);
	const CAN_PARAM_COUNT = 3;
	if      (canList.length % CAN_PARAM_COUNT != 0) {}
	else if (canList.length < 2 * CAN_PARAM_COUNT) {}
	else if (canList.length > MAX_CANDIDATES * CAN_PARAM_COUNT) {}
	else {
		candidateCount = canList.length / CAN_PARAM_COUNT;
		generateCandidates();
		for (let c1 = 0; c1 < candidateCount; c1++) {
			candidate_data[c1][0] = xScale.invert(canList[CAN_PARAM_COUNT*c1]);
			candidate_data[c1][1] = yScale.invert(canList[CAN_PARAM_COUNT*c1 + 1]);
			candidate_data[c1][4] = canList[CAN_PARAM_COUNT*c1 + 2];
		}
		if (!isSimRunning) {
			d3.select('#canAddButton').attr('disabled', candidateCount >= MAX_CANDIDATES ? "" : null);
			d3.select('#canRemoveButton').attr('disabled', candidateCount <= 2 ? "" : null);
		}
	}
}

measureVoterDistancesAll(voter_data, candidate_data);
calculateVoterRanks(voter_data);

let bins;
function calcHexbinColors(can1 = null, can2 = null, mode = null, regretMethodID = null) {
	if (bins == null) {return;}
	for (let j = 0; j < bins.length; j++) {
		let bin = bins[j];
		let total = 0;
		let color_count = new Array(6).fill(0);
		for (let i = 0; i < bin.length; i++) {
			let favorite = -1;
			for (let k = 0; k < candidateCount; k++) {
				if (candidate_data[bin[i][3][k]][5]) {continue;} //check if hidden
				favorite = bin[i][3][k]; break;
			}
			
			switch (mode) {
				case null:
					color_count[favorite]++;
					break;
				case "Matchup":
					bin[i][3].indexOf(can1) < bin[i][3].indexOf(can2) ? color_count[can1]++ : color_count[can2]++;
					break;
				case "LowTurnout":
					if (bin[i][5]) { color_count[favorite]++; }
					break;
				case "Score":
					let score = baseCARS.dispo_normalized_voter_data[bin[i][4]][can1];
					color_count[can1] += 1 - score;
					break;
				case "Approval":
					let ascore = baseCARS.dispo_normalized_voter_data[bin[i][4]][can1];
					if (ascore < 0.5) { color_count[can1]++; }
					break;
				case "Regret":
					let score1 = baseCARS.dispo_normalized_voter_data[bin[i][4]][can1];
					let score2 = baseCARS.dispo_normalized_voter_data[bin[i][4]][can2];
					switch(methodList[regretMethodID]) {
						case "Plurality":
							if (score2 < score1 && favorite != can2) {
								color_count[favorite]++;
							}
							break;
						case "RawRange":
							if (score2 < score1) {
								color_count[favorite] += score2 + (1 - score1);
							}
							break;
						case "NormalRange":
							if (score2 < score1 && (score1 > 0 || score2 < 1)) {
								color_count[favorite]++;
							}
							break;
						case "Approval":
							if (score2 < score1 && ((score1 < 0.5 && score2 < 0.5) || (score1 >= 0.5 && score2 >= 0.5))) {
								color_count[favorite]++;
							}
							break;
						case "V321":
							if (score2 < score1 && score1 < 1.0 && ((score1 < 0.5 && score2 < 0.5) || (score1 >= 0.5 && score2 >= 0.5))) {
								color_count[favorite]++;
							}
							break;
						case "Median":
							if (score2 < score1) {
								/*if (score1 < baseCARS.medianScores[can1]) {
									color_count[favorite] += baseCARS.medianScores[can1] - score1;
								}
								if (score2 > baseCARS.medianScores[can2]) {
									color_count[favorite] += score2 - baseCARS.medianScores[can2];
								}*/
								if (score1 < baseCARS.medianScores[can1] || score2 > baseCARS.medianScores[can2]) {
									color_count[favorite]++;
								}
							}
							break;
						default:
							break;
					}
					break;
				case "Monotonic":
					break;
				default:
					break;
			}
			total++;
		}
		let myColor;
		let intensity = 0;
		if (isHeatmapActive) {
			//pass
		} else if (mode == "Regret") {
			let color_rank = Array.from(Array(color_count.length).keys())
				.sort((a, b) => color_count[a] < color_count[b] ? 1 : -1);
			myColor = d3.schemeCategory10[color_rank[0]];
			intensity = color_count[color_rank[0]]/total;
		} else {
			let color_rank = Array.from(Array(color_count.length).keys())
				.sort((a, b) => color_count[a] < color_count[b] ? 1 : -1);
			myColor = d3.schemeCategory10[color_rank[0]];
			intensity = color_count[color_rank[0]]/total;
		}
		bin.c = d3.interpolateRgb(myColor, "grey")(1 - intensity);
	}
}

let chart = d3.select("#main_chart")
	.select("svg")
		.attr("width", width + margin.left + margin.right)
		.attr("height", height + margin.top + margin.bottom)
	.append("g")
		.attr("transform", "translate(" + margin.left + "," + margin.top + ")");
chart.append('g')
	.attr("transform", "translate(0," + height + ")")
	.call(d3.axisBottom(xScale));
chart.append('g')
	.call(d3.axisLeft(yScale));
let chartBinNode = chart.append("g");
let chartHeatmapNode = chart.append("g");
let chartCandidateNode = chart.append("g");

let contour_legend = d3.select("#contour_legend").style("opacity", 0);
let cardinal_tooltip = d3.select("#cardinal_tooltip").style("opacity", 0);
let hexbin_tooltip = d3.select("#hexbin_tooltip").style("opacity", 0);
let info_tooltip = d3.select("#info_tooltip").style("opacity", 0);
let info_tooltip_DOM = document.getElementById('info_tooltip');

function generateNewElectorate(category, num = 10000) {
	generateElectorate(category, num);
	measureVoterDistancesAll(voter_data, candidate_data);
	calculateVoterRanks(voter_data);
	startWorker(); //risky but performant
	createHexbin();
	candidatesOnTop();
	updateHexbinColors();
	clearUtilityWinnerTableBody();
	clearMethodTableBody();
}
document.querySelector("#electorateNormalButton").addEventListener("click", e => generateNewElectorate("Normal"));
document.querySelector("#electorateFlatButton").addEventListener("click", e => generateNewElectorate("One"));
document.querySelector("#electoratePolarizedButton").addEventListener("click", e => generateNewElectorate("Polarized"));
document.querySelector("#electorateClusteredButton").addEventListener("click", e => generateNewElectorate("Clustered"));
document.querySelector("#electorateFanButton").addEventListener("click", e => generateNewElectorate("Fan"));

let last_generated_time = Date.now();
const generated_time_limit = 1000;
function generateNewCandidates(category, isSkipRefresh = false) {
	if (isSkipRefresh) {
		generateCandidates(category);
		return; //we will skip all recalculations
	}
	
	if (Date.now() - last_generated_time < generated_time_limit) { return; }
	last_generated_time = Date.now();
	
	if (category == "Remove" && isHeatmapActive && candidateCount <= heatmapCandidateCount) { return; }
	if (category == "Remove" && candidate_data[candidate_data.length - 1][5]) { //removing hidden candidate
		isSkipRefresh = true; //we will skip most recalculations
	}
	generateCandidates(category);
	if (category == "Add" && isHeatmapActive && candidateCount == heatmapCandidateCount + 1 && heatmapNewCandidateDispo > -1) {
		candidate_data[candidateCount-1][4] = heatmapNewCandidateDispo; //override new random dispo to match existing heatmap
	}
	measureVoterDistancesAll(voter_data, candidate_data);
	calculateVoterRanks(voter_data);
	if (isSkipRefresh) {
		createCandidates();
	} else {
		startWorker(); //risky but performant
		createCandidates();
		updateHexbinColors();
		clearUtilityWinnerTableBody();
		clearMethodTableBody();
	}
	if (!isSimRunning) {
		if (isHeatmapActive) {			
			d3.select('#canAddButton').attr('disabled', candidateCount != heatmapCandidateCount ? "" : null);
			d3.select('#canRemoveButton').attr('disabled', candidateCount <= heatmapCandidateCount ? "" : null);			
		} else {
			d3.select('#canAddButton').attr('disabled', candidateCount >= MAX_CANDIDATES ? "" : null);
			d3.select('#canRemoveButton').attr('disabled', candidateCount <= 2 ? "" : null);
		}
	}
}
document.querySelector("#canAddButton").addEventListener("click", e => generateNewCandidates("Add"));
document.querySelector("#canRemoveButton").addEventListener("click", e => generateNewCandidates("Remove"));
document.querySelector("#canShuffleButton").addEventListener("click", e => generateNewCandidates("Uniform"));
document.querySelector("#canClusterButton").addEventListener("click", e => generateNewCandidates("Cluster"));
document.querySelector("#canPartyClusterButton").addEventListener("click", e => generateNewCandidates("Party-Cluster"));

const hexbin = d3.hexbin();
let r = 0.25;
hexbin.radius(r);
function createHexbin() {
	bins = hexbin(voter_data);
	let r_max = width / 10 * r - 1;
	let biggestBinSize = 0;
	bins.forEach((b) => {if (b.length > biggestBinSize) biggestBinSize = b.length; });
	let hexScale = Math.sqrt(biggestBinSize)/r_max * 0.8;
	chartBinNode.selectAll('.bin').remove();
	chartBinNode
		.selectAll("hexbin")
		.data(bins)
		.enter()
		.append("path")
			.attr("class", "bin")
			.attr("d", d => `M${xScale(d.x)},${yScale(d.y)}${hexbin.hexagon(Math.min(Math.sqrt(d.length)/hexScale,r_max))}`)
			.attr("fill", "#cccccc")
		.on('mouseover', function (e, bin) {
			d3.select(this).transition()
				.duration('50')
				.attr('opacity', '.85');
			hexbin_tooltip.raise().transition()
				.duration('50')
				.style("opacity", 1);
			hexbin_tooltip
				.style("left", (e.pageX + 10) + "px")
				.style("top", (e.pageY - 15) + "px");
			let voterReport = {};
			for (let i = 0; i < bin.length; i++) {
				let s = bin[i][3].toString();
				if (s in voterReport) {voterReport[s]++;}
				else {voterReport[s] = 1;}
			}
			hexbin_tooltip.selectAll("p").remove();
			for (const [key, value] of Object.entries(voterReport)) {
				hexbin_tooltip.append("p").text(value.toString() + ": " + rankArray2string(key));
			}
		})
		.on('mouseout', function (e) {
			d3.select(this).transition()
				.duration('50')
				.attr('opacity', '1');
			hexbin_tooltip.transition()
				.duration('50')
				.style("opacity", 0);
		});
}
createHexbin();
updateHexbinQuick();

function updateHexbinColors() {	
	calculateVoterRanks(voter_data);
	calcHexbinColors();
	chartBinNode.selectAll(".bin").transition().attr("fill", d => d.c);
}

function updateHexbinQuick(colorA = null, colorB = null, mode = null, regretMethodID = null) {
	calcHexbinColors(colorA, colorB, mode, regretMethodID);
	chartBinNode.selectAll(".bin").transition().attr("fill", d => d.c);
}

let dragCandidateListeners = d3.drag()
	.on("start", dragCandidateStarted)
	.on("drag", dragCandidate)
	.on("end", dragCandidateEnded);

function createCandidates() {
	
	let candidates = chartCandidateNode.selectAll('.candidate');
	while (candidates.size() > candidate_data.length) {
		 candidates = candidates.filter(function(d, i,list) { return i === list.length - 1;}).remove();
	}
	let addNew = candidates.size() < candidate_data.length;
	candidates = chartCandidateNode.selectAll(".candidate")
		.data(candidate_data)
		.enter()
		.append("g")
			.call(dragCandidateListeners)
			.on("click", clickedCandidate)
			.attr("id", d => d[3])
			.attr("class", "candidate")
			.on('contextmenu', d3.contextMenu(candidateRightClickMenu));
	
	if (isCandidateGenFirst) {
		chartCandidateNode.selectAll(".candidate")
			.attr("transform", d => "translate(" + xScale(d[0]) + "," + yScale(d[1]) + ")");
			
		let innerCandidates = candidates.append('g')
			.attr("transform", d => "scale(1,1)");
				
		innerCandidates.append("circle")
			.attr("r", CANDIDATE_RADIUS)
			.attr("fill", d => d3.schemeCategory10[d[3]])
			.attr("stroke", "black");

		innerCandidates.append("text")
			.text(d => label(d[3]))
			.attr("dx", -7)
			.attr("dy", 7)
			
		isCandidateGenFirst = false;
	} else {
		if (addNew) {
			candidates.filter(function(d, i,list) { return i === list.length - 1;})
				.attr("transform", d => "scale(1,1) translate(" + xScale(d[0]) + "," + yScale(d[1]) + ")")
				.transition()
				.attr("transform", d => "scale(2,2) translate(" + xScale(d[0])/2 + "," + yScale(d[1])/2 + ")")
				.transition()
				.attr("transform", d => "scale(1,1) translate(" + xScale(d[0]) + "," + yScale(d[1]) + ")");
				
			let innerCandidates = candidates.append('g')
				.attr("class", "scaleG")
				.attr("transform", d => "scale(1,1)");
					
			innerCandidates.append("circle")
				.attr("r", CANDIDATE_RADIUS)
				.attr("fill", d => d3.schemeCategory10[d[3]])
				.attr("stroke", "black");

			innerCandidates.append("text")
				.text(d => label(d[3]))
				.attr("dx", -7)
				.attr("dy", 7)
				.style("font-size", 22);
		} else {
			chartCandidateNode.selectAll(".candidate")
				.transition()
				.attr("transform", d => "translate(" + xScale(d[0]) + "," + yScale(d[1]) + ")");
		}
	}

	

	
}
createCandidates();

function candidatesOnTop() {
	chartCandidateNode.selectAll(".candidate").raise();
}


function clickedCandidate(event, c) {
	if (event.defaultPrevented) return; // dragged
	d3.select(this).select('.scaleG').transition()
		.attr("transform", "scale(2,2)")
		.transition()
		.attr("transform", "scale(1,1)");
	d3.select(this).select('circle').transition()
		.attr("fill", "yellow")
		.transition()
		.attr("fill", d3.schemeCategory10[c[3]]);
}


function dragCandidateStarted() {
	d3.select(this).attr("stroke", "yellow");
}
function dragCandidate(e, c) {
	let c1 = c[3];
	terminateWorker();
	if (isHeatmapActive && c1 < heatmapCandidateCount) { return; }
	candidate_data[c1][0] = xScale.invert(e.x);
	candidate_data[c1][1] = yScale.invert(e.y);
	d3.select(this).raise().attr("transform", "translate(" + e.x + "," + e.y + ")");
	
	measureVoterDistance(voter_data, candidate_data, c1);
	calculateVoterRanks(voter_data);
	startWorker(); //risky but performant
	updateHexbinColors();
	clearUtilityWinnerTableBody();
	clearMethodTableBody();
}
function dragCandidateEnded() {
	d3.select(this).attr("stroke", "black");
	d3.selectAll(".candidate").sort((a,b) => d3.ascending(a[3], b[3]));
}

function hideCandidate(candidate) {
	let isAllHidden = true;
	for (let c = 0; c < candidate_data.length; c++) {
		if (candidate == c) {continue;}
		if (!candidate_data[c][5]) {isAllHidden = false; break;}
	}
	if (isAllHidden) {return;}
	candidate_data[candidate][5] = true;
	chartCandidateNode.selectAll('.candidate').filter(c => c[3] == candidate)
		.transition()
		.duration('300')
		.attr('opacity', '0.2');
	clearUtilityWinnerTableBody();
	clearMethodTableBody();
	startWorker(false, true);
	updateHexbinQuick();
}
window.hideCandidate = hideCandidate;
function unhideCandidate(candidate) {
	candidate_data[candidate][5] = false;
	chartCandidateNode.selectAll('.candidate').filter(c => c[3] == candidate)
		.transition()
		.duration('100')
		.attr('opacity', '1.0');
	clearUtilityWinnerTableBody();
	clearMethodTableBody();
	startWorker(false, true);
	updateHexbinQuick();
}
window.unhideCandidate = unhideCandidate;

function getCandidateZ(candidate) {
	return candidate_data[candidate][6];
}
window.getCandidateZ = getCandidateZ;

function setCandidateZ(candidate, z) {
	candidate_data[candidate][6] = z;
	measureVoterDistance(voter_data, candidate_data, candidate);
	calculateVoterRanks(voter_data);
	startWorker(); //risky but performant
	updateHexbinColors();
	clearUtilityWinnerTableBody();
	clearMethodTableBody();
	startWorker(false, true);
	updateHexbinQuick();
}
window.setCandidateZ = setCandidateZ;

function startHighlightMatchup(candidateA, candidateB) {
	chartCandidateNode.selectAll('.candidate').filter(function(){return d3.select(this).attr('id') != candidateA &&
	                                                       d3.select(this).attr('id') != candidateB; })
		.transition()
		.attr('opacity', '.10');
	updateHexbinQuick(candidateA, candidateB, "Matchup");
}
function startHighlightLowTurnout() {
	updateHexbinQuick(null, null, "LowTurnout");
}
function startHighlightScore(candidate) {
	chartCandidateNode.selectAll('.candidate').filter(function(){return d3.select(this).attr('id') != candidate;})
		.transition()
		.attr('opacity', '.10');
	updateHexbinQuick(candidate, null, "Score");
}
function startHighlightApproval(candidate) {
	chartCandidateNode.selectAll('.candidate').filter(function(){return d3.select(this).attr('id') != candidate;})
		.transition()
		.attr('opacity', '.10');
	updateHexbinQuick(candidate, null, "Approval");
}
function endHighlight() {
	chartCandidateNode.selectAll('.candidate').filter(c => !c[5])
		.transition()
		.attr('opacity', '1.0');
	chartCandidateNode.selectAll('.candidate').filter(c => c[5])
		.transition()
		.attr('opacity', '0.2');
	updateHexbinQuick();
}

let baseCARS;
let MRDs = {};
window.baseCARS = function() {return baseCARS;};
window.MRDs = function() {return MRDs;};
let baseCARS_cache = {};
let MRDs_cache = {};

function initializeUtilityWinnerTable() {
	let thead_tr = d3.select('#utility_winner_table tr');
	for (let d = 0; d <= 10; d++) {
		thead_tr.append('td').text(d);
	}
	let tbody_tr = d3.select('#utility_winner_table_body tr');
	for (let d = 0; d <= 10; d++) {
		tbody_tr.append('td');
	}
}
initializeUtilityWinnerTable();

function clearUtilityWinnerTableBody() {
	d3.select('#utility_winner_table_body').selectAll('td')
		.text("").attr("class", null);
}
function updateUtilityWinnerTable() {
	let tr = d3.select('#utility_winner_table_body tr');
	for (let d = 0; d <= 10; d++) {
		tr.select('td:nth-child(' + (d+1) + ')').text(label(baseCARS.utilityWinners[d]))
			.attr("class", getResultsColorClass(baseCARS.utilityWinners[d])); 
	}
}

function updateResultsTable() {	
	let thead_tr = d3.select('#results_table tr');
	let tbody = d3.select('#results_table_body');
	
	thead_tr.selectAll('td').remove();
	tbody.selectAll('tr').remove();
	
	thead_tr.append('td').text("");
	for (let c1 = 0; c1 < baseCARS.sortedWins.length; c1++) {
		thead_tr.append('td').text(label(baseCARS.sortedWins[c1]));
	}
	for (let c1 = 0; c1 < baseCARS.sortedWins.length; c1++) {
		let can1 = baseCARS.sortedWins[c1];
		let tr = tbody.append('tr');
		tr.append('td').text(label(baseCARS.sortedWins[c1]));
		for (let c2 = 0; c2 < baseCARS.sortedWins.length; c2++) {
			let can2 = baseCARS.sortedWins[c2];
			if (c1 == c2 || candidate_data[can1][5] || candidate_data[can2][5]) { //if same or either is hidden
				tr.append('td').attr("class", "grid-null");
			} else if (baseCARS.results[can1][can2] >= baseCARS.results[can2][can1]) {
				
				tr.append('td').text(baseCARS.results[can1][can2])
					.attr("id", can1 + " " + can2)
					.attr("class", baseCARS.firstRankVotes != null && baseCARS.firstRankVotes[can1] > voter_data.length/2 ? "grid-majority-winner" : "grid-winner")
					.on("mouseover", mouseoverMatchup)
					.on("mouseout", mouseoutMatchup);
			} else {
				tr.append('td').text(baseCARS.results[baseCARS.sortedWins[c1]][baseCARS.sortedWins[c2]])
					.attr("id", baseCARS.sortedWins[c1] + " " + baseCARS.sortedWins[c2])
					.attr("class", "grid-loser")
					.on("mouseover", mouseoverMatchup)
					.on("mouseout", mouseoutMatchup);
			}
		}
	}
}

function mouseoverMatchup(e) {
	let candidates = e.target.id.split(' ').map(x => parseInt(x));
	startHighlightMatchup(candidates[0], candidates[1]);
	d3.select('#results_table_body')
		.select('tr:nth-child(' + (baseCARS.sortedWins.indexOf(candidates[0]) + 1) + ')')
		.select('td')
		.attr("class", "highlighted");
	d3.select('#results_table').select('tr')
		.select('td:nth-child(' + (baseCARS.sortedWins.indexOf(candidates[1]) + 2) + ')')
		.attr("class", "highlighted");
}

function mouseoutMatchup() {
	endHighlight();
	d3.select('#results_table_body')
		.selectAll('tr').select('td')
		.attr("class", "");
	d3.select('#results_table').select('tr')
		.selectAll('td')
		.attr("class", "");
}

function initializeCardinalTable() {
	let thead_tr = d3.select('#cardinal_table tr');
	thead_tr.append('td').text("");
	//thead_tr.append('td').text("Score");
	thead_tr.append('td').text("Normalized Scores")
		.on('mouseover', e => displayInfoTooltip(e, ["Total scores of normalized ballots, as used in the \"NormalRange\" method."]))
		.on('mouseout', clearInfoTooltip);
	thead_tr.append('td').text("Approvals")
		.on('mouseover', e => displayInfoTooltip(e, ["Total approvals, as used in the \"Approval\" method."]))
		.on('mouseout', clearInfoTooltip);
	thead_tr.append('td').text("Supporter Disposition")
		.on('mouseover', e => displayInfoTooltip(e,
		["Disposition of voters with regards to expressing their innate preference intensities as ballot ratings. (Is it sublinear, linear, or superlinear?) This affects all normalized Range and Approval methods.",
		 "For purposes of this simulation, all primary supporters of a candidate share the same averaged disposition. (Perhaps taking cues from their leader?)",
		 "A slider set to the LEFT indicates picky or selfish voters. Fully left is probably \"bullet voting\" for their favorite.",
		 "A slider set to the RIGHT indicates indifferent or compromising voters. Fully right is probably \"anti-bullet voting\" against their least favorite."]))
		.on('mouseout', clearInfoTooltip);
}
initializeCardinalTable();
const maxScoreColor    = "#bbffbb";
const minScoreColor    = "#aaccaa";
const maxApprovalColor = "#bbddff";
const minApprovalColor = "#aaaacc";
function updateCardinalTable(partialUpdate = false) {
	
	let tbody = d3.select('#cardinal_table_body');
	if (partialUpdate == false) { tbody.selectAll('tr').remove(); }
	
	let maxScore    = Math.min(...baseCARS.totalNormalizedDistance.filter(x => x !== null));
	let minScore    = Math.max(...baseCARS.totalNormalizedDistance.filter(x => x !== null));
	let maxApproval = Math.min(...baseCARS.totalApprovalScores.filter(x => x !== null));
	let minApproval = Math.max(...baseCARS.totalApprovalScores.filter(x => x !== null));
	
	for (let c1 = 0; c1 < candidate_data.length; c1++) {
		let candidate = baseCARS.sortedWins[c1];
		let isHidden = candidate_data[candidate][5];
		let tr;
		if (partialUpdate == false) {
			tr = tbody.append('tr');
			tr.append('td').text(label(candidate));
			if (isHidden) {
				tr.append('td').attr("class", "grid-null");
				tr.append('td').attr("class", "grid-null");
			} else {
				tr.append('td')
					.attr("id", "Score_" + candidate)
					.on("mouseover", mouseoverScore)
					.on("mouseout", mouseoutCardinal);
				tr.append('td')
					.attr("id", "Approval_" + candidate)
					.on("mouseover", mouseoverApproval)
					.on("mouseout", mouseoutCardinal);
			}
			let td = tr.append('td');
				let wrapper = td.append('div')
					.attr('class', "dispo-control-row")
					let div = wrapper.append('div');
						div.append('img')
						.attr('src', "icon-face-to-face.svg")
						.attr('type', "type=\"image/svg+xml\"")
						.attr('id', "Greedy_" + candidate)
						.attr('class', "dispo-icon")
						.attr('style', getDispoColorGreedy(candidate_data[candidate][4]));
					wrapper.append('input')
						.attr("id", "Disposition_" + candidate)
						.attr("type", "range")
						.attr("class", "slider")
						.attr("min", 0)
						.attr("max", 10)
						.attr("value", candidate_data[candidate][4])
						.property("disabled", isHeatmapActive)
						.on("mousedown", onDispositionSliderClick)
						.on("input", onDispositionSliderChange)
						.on('mouseup', clearSampleBallotDispoTooltip);
					div = wrapper.append('div');
						div.append('img')
						.attr('src', "icon-three-friends.svg")
						.attr('id', "Compromising_" + candidate)
						.attr('class', "dispo-icon")
						.attr('style', getDispoColorCompromising(candidate_data[candidate][4]));
		} else {
			tr = tbody.select("tr:nth-child(" + (c1+1)+ ")");
		}
		if (!isHidden) {
			tr.select('td:nth-child(2)').text(Math.floor((voter_data.length - baseCARS.totalNormalizedDistance[candidate])*10)/10)
				.attr("style", "background-color: " + d3.interpolateRgb(maxScoreColor, minScoreColor)(
					(baseCARS.totalNormalizedDistance[candidate] - maxScore)/(minScore - maxScore)));
			tr.select('td:nth-child(3)').text(voter_data.length - baseCARS.totalApprovalScores[candidate])
				.attr("style", "background-color: " + d3.interpolateRgb(maxApprovalColor, minApprovalColor)(
					(baseCARS.totalApprovalScores[candidate] - maxApproval)/(minApproval - maxApproval)));
		}
	}
}
function onDispositionSliderClick(e) {
	let candidate = parseInt(e.target.id.slice(e.target.id.length-1));
	showSampleBallotDispoTooltip(candidate, true);
}
function onDispositionSliderChange(e) {
	let candidate = parseInt(e.target.id.slice(e.target.id.length-1));
	candidate_data[candidate][4] = e.target.value;
	showSampleBallotDispoTooltip(candidate, false);
	d3.select('#Greedy_' + candidate).attr("style", getDispoColorGreedy(candidate_data[candidate][4]));
	d3.select('#Compromising_' + candidate).attr("style", getDispoColorCompromising(candidate_data[candidate][4]));
	clearMethodTableBody(true);
	startWorker(true, true);
}
function getDispoColorGreedy(x)       { return "filter: saturate(" + (1- x/10) + ") brightness(" + (1 + x/3) + ") "; }
function getDispoColorCompromising(x) { return "filter: saturate(" + (x/10)    + ") brightness(" + (5.5 - x/3) + ") "; }
function mouseoverScore(e) {
	let candidate = parseInt(e.target.id.slice(e.target.id.length-1));
	startHighlightScore(candidate);
	d3.select('#cardinal_table_body')
		.select('tr:nth-child(' + (baseCARS.sortedWins.indexOf(candidate) + 1) + ')')
		.select('td')
		.attr("class", "highlighted");
	d3.select('#cardinal_table').select('tr')
		.select('td:nth-child(2)')
		.attr("class", "highlighted");
}
function mouseoverApproval(e) {
	let candidate = parseInt(e.target.id.slice(e.target.id.length-1));
	startHighlightApproval(candidate);
	d3.select('#cardinal_table_body')
		.select('tr:nth-child(' + (baseCARS.sortedWins.indexOf(candidate) + 1) + ')')
		.select('td')
		.attr("class", "highlighted");
	d3.select('#cardinal_table').select('tr')
		.select('td:nth-child(3)')
		.attr("class", "highlighted");
}
function mouseoutCardinal() {
	endHighlight();
	d3.select('#cardinal_table_body')
		.selectAll('tr').select('td')
		.attr("class", "");
	d3.select('#cardinal_table').select('tr')
		.selectAll('td')
		.attr("class", "");
}
let sampleBallotVoterID = -1;
function showSampleBallotDispoTooltip(candidate, newVoterID = true,
                                      regretWinnerID = null, regretLoserID = null, regretMethodID = null) {
	
	if (regretMethodID != null && baseCARS.cs.length < 3) {return;}
	let voter;
	if (newVoterID) {
		let voters;
		if (regretMethodID == null) {
			voters = voter_data.filter(e => e[3][0] == candidate);
		} else {
			switch (methodList[regretMethodID]) {
				case "Plurality":
					voters = voter_data.filter(e => e[2][regretLoserID] < e[2][regretWinnerID] &&
					                                e[3][0] != regretLoserID);
					break;
				case "RawRange":
					voters = voter_data.filter(e => { let l = e[2][regretLoserID]; let w = e[2][regretWinnerID];
					                                  return (l < w) && (w-l < 5);});
					break;
				case "NormalRange":
					voters = voter_data.filter(e => { let n = baseCARS.dispo_normalized_voter_data[e[4]];
					                                  let l = n[regretLoserID];
					                                  let w = n[regretWinnerID];
					                                  return (l < w) && (w-l < 1);});
					break;
				case "Approval":
					voters = voter_data.filter(e => { let n = baseCARS.dispo_normalized_voter_data[e[4]];
					                                  let l = n[regretLoserID];
					                                  let w = n[regretWinnerID];
					                                  return (l < w) && ((l > 0.5 && w > 0.5) || (l <= 0.5 && w <= 0.5));});
					break;
				case "V321":
					voters = voter_data.filter(e => { let n = baseCARS.dispo_normalized_voter_data[e[4]];
					                                  let l = n[regretLoserID];
					                                  let w = n[regretWinnerID];
					                                  return (l < w) && (w < 1.0) && ((l > 0.5 && w > 0.5) || (l <= 0.5 && w <= 0.5));});
					break;
				case "Median":
					voters = voter_data.filter(e => { let n = baseCARS.dispo_normalized_voter_data[e[4]];
					                                  let l = n[regretLoserID];
					                                  let w = n[regretWinnerID];
					                                  return (l < w) && (l > baseCARS.medianScores[regretLoserID] ||
					                                                     w < baseCARS.medianScores[regretWinnerID]);});
					break;
				default:
					break;
			}
		}
		if (voters.length == 0) {return;}
		shuffle(voters);
		voter = voters[0];
		sampleBallotVoterID = voter[4];
	} else {
		voter = voter_data[sampleBallotVoterID];
	}
	let dispo = candidate_data[voter[3][0]][4]; //favorite's dispo strat
	
	d3.select('#sample_ballot_arrow')
		.raise()
		.attr("transform", "translate(" + (Math.floor(xScale(voter[0]))+30) + ',' +
		                                  (Math.floor(yScale(voter[1]))-10) + ')')
		.transition()
		.duration('50')
		.style("opacity", 1);
	
	cardinal_tooltip.selectAll("p").remove();
	cardinal_tooltip
		.raise()
		.style("left", (xScale(3.8)) + "px")
		.style("top", (yScale(-2.5)-Math.max(3, candidate_data.length)*30) + "px")
		.transition()
		.duration('50')
		.style("opacity", 1);

	cardinal_tooltip.append('p').text(regretMethodID == methodList.indexOf("Approval") ? "Sample Approval Ballot" :
	                                regretMethodID == methodList.indexOf("V321") ? "Sample 3-2-1 Ballot" :
	                                regretMethodID == methodList.indexOf("Plurality") ? "Sample Ballot" :
	                                "Sample Rated Ballot");
	cardinal_tooltip.append('p').text("Voter #" + sampleBallotVoterID).attr("class", "voter-id-label");
	
	let myMin = 9999999;
	let myMax = 0;
	let isFirst = true;
	for (let c1 = 0; c1 < baseCARS.cs.length; c1++) {
		let can1 = baseCARS.cs[c1];
		myMin = Math.min(myMin, voter[2][can1]);
		myMax = Math.max(myMax, voter[2][can1]);
	}
	for (let c1 = 0; c1 < baseCARS.cs.length; c1++) {
		let can1 = voter[3][baseCARS.cs[c1]];
		let x = voter[2][can1];
		let score = 0;
		if      (x <= myMin) { score = 0; }
		else if (x >= myMax) { score = 1; }
		else {
			score = (x - myMin) / (myMax - myMin) *
			        (1 - PERFECTION_PENALTY) + PERFECTION_PENALTY;
		}
		score = applyDispo(score, dispo);
		let str;
		switch (methodList[regretMethodID]) {
			case "Plurality":
				str = label(can1) + ": " + (isFirst ? 'O' : '');
				isFirst = false;
				break;
			case "V321":
			case "Approval":
				let mark = score < 0.5 ? 'O' : '-';
				if (methodList[regretMethodID] == "V321" && score >= 1.0) { mark = "X"; }
				str = label(can1) + ": " + mark + " (" + Math.floor((1-score)*100) + "%)";
				break;
			case "RawRange":
				str = label(can1) + ": " + voter[2][can1].toFixed(2) + "";
				break;
			default:
				str = label(can1) + ": " + Math.floor((1-score)*100) + "%";
				break;
		}
		cardinal_tooltip.append('p')
			.text(str)
			.attr("class", regretWinnerID == can1 ? "sample-ballot-line-regret" :
			               regretLoserID  == can1 ? "sample-ballot-line-regret" :
			               "sample-ballot-line");
	}
	
	if (baseCARS.cs.length == 2) {
		cardinal_tooltip.append('p')
			.text("Disposition is irrelevant when there are just 2 candidates.")
			.attr("class", "sample-ballot-dispo2-warning");
	} else if (baseCARS.cs.length < 2) {
		cardinal_tooltip.append('p')
			.text("\"Democracy.\"")
			.attr("class", "sample-ballot-dispo2-warning");
	} else if (regretMethodID != null) {
		let s;
		let soreLoser = voter[2][regretLoserID] < voter[2][regretWinnerID];
		let winnerScore = baseCARS.dispo_normalized_voter_data[sampleBallotVoterID][regretWinnerID];
		let loserScore = baseCARS.dispo_normalized_voter_data[sampleBallotVoterID][regretLoserID];
		switch (methodList[regretMethodID]) {
			case "Plurality":
				if      (sampleBallotVoterID % 5 == 0) { s = "Urg, why didn't I just vote for " + label(regretLoserID) + "?"; }
				else if (sampleBallotVoterID % 5 == 1) { s = "I knew I should have voted for " + label(regretLoserID) + "!"; }
				else if (sampleBallotVoterID % 5 == 2) { s = "Great, now I'm stuck with " +label(regretWinnerID) + " who is even worse than " + label(regretLoserID) + "..."; }
				else if (sampleBallotVoterID % 5 == 3) { s = "Remind me to vote for " + label(regretLoserID) + " next time, instead of wasting my vote."; }
				else                                   { s = label(regretLoserID) + " had the better chance of actually winning... Why didn't I vote for them?"; }
				break;
			case "RawRange":
				if (soreLoser) {
					if      (sampleBallotVoterID % 9 == 0) { s = "I could have given even MORE support to " + label(regretLoserID) + "!"; }
					else if (sampleBallotVoterID % 9 == 1) { s = "Why didn't I support " + label(regretLoserID) + " more?"; }
					else if (sampleBallotVoterID % 9 == 2) { s = "I could have opposed " + label(regretWinnerID) + " more strongly..."; }
					else if (sampleBallotVoterID % 9 == 3) { s = "Looks like my partial support for " + label(regretWinnerID) + " was a mistake."; }
					else if (sampleBallotVoterID % 9 == 4) { s = "Next time I'll rate " + label(regretWinnerID) + " as poorly as possible."; }
					else if (sampleBallotVoterID % 9 == 5) { s = "Why didn't I support " + label(regretLoserID) + " more?"; }
					else if (sampleBallotVoterID % 9 == 6) { s = "I guess it came down to " + label(regretWinnerID) + " vs. " + label(regretLoserID) + "; I should have voted accordingly."; }
					else if (sampleBallotVoterID % 9 == 7) { s = "Now I regret giving any support at all to " + label(regretWinnerID) + "."; }
					else                                   { s = "Should have been more firm on my support for " + label(regretLoserID) + "."; }
					break;
				} /*else {
					if      (sampleBallotVoterID % 5 == 0) { s = "I'm happy " + label(regretWinnerID) + " won, but I would have voted differently if I knew how close it was going to be with " + label(regretLoserID) + "."; }
					else if (sampleBallotVoterID % 5 == 1) { s = "If I had supported " + label(regretWinnerID) + " more, it wouldn't have been as close."; }
					else if (sampleBallotVoterID % 5 == 2) { s = "Glad to see " + label(regretWinnerID) + " defeat " + label(regretLoserID) + ", but I should have done more to support " + label(regretWinnerID) + "."; }
					else if (sampleBallotVoterID % 5 == 3) { s = "Call me a sore winner, but I regret giving any points at all to " + label(regretLoserID) + ". I can't believe they almsot won."; }
					else                                   { s = "Wait, why did I give any points to " + label(regretLoserID) + " again?  It would have been bad if they beat " + label(regretWinnerID) + "!"; }
					break;
				} */
				break;
			case "Median":
			case "NormalRange":
				if (soreLoser) {
					if (winnerScore < 1) {
						if      (sampleBallotVoterID % 5 == 0) { s = "I know this is hindsight talking, but why did I give any points at all to " + label(regretWinnerID) + "?!"; }
						else if (sampleBallotVoterID % 5 == 1) { s = "I guess it's partly my fault " + label(regretWinnerID) + " won instead of " + label(regretLoserID) + '.'; }
						else if (sampleBallotVoterID % 5 == 2) { s = "I would have voted " + label(regretWinnerID) + " lower if I knew that " + label(regretLoserID) + " had a real shot at beating them."; }
						else if (sampleBallotVoterID % 5 == 3) { s = "Mad that " + label(regretWinnerID) + " won. Madder that I helped."; }
						else                                   { s = "The points I gave " + label(regretWinnerID) + " backfired and made " + label(regretLoserID) + " come in second!"; }
					} else {
						if      (sampleBallotVoterID % 5 == 0) { s = "I should have given more points to " + label(regretLoserID) + "..."; }
						else if (sampleBallotVoterID % 5 == 1) { s = "Why didn't I support " + label(regretLoserID) + " more?"; }
						else if (sampleBallotVoterID % 5 == 2) { s = "I guess it came down to " + label(regretWinnerID) + " vs. " + label(regretLoserID) + "; I should have rated " + label(regretLoserID) + " higher."; }
						else if (sampleBallotVoterID % 5 == 3) { s = "Next time I'll max out my score for " + label(regretLoserID) + ". I'm so mad!"; }
						else                                   { s = "Should have been more firm on my support for " + label(regretLoserID) + "."; }
					}
				} /*else {
					if (loserScore < 1) {
						if      (sampleBallotVoterID % 5 == 0) { s = "Should have given even less support to " + label(regretLoserID) + ", since they turned out to be our true rival."; }
						else if (sampleBallotVoterID % 5 == 1) { s = "Wait, what if those points I gave " + label(regretLoserID) + " had made " + label(regretWinnerID) + " lose? Scary!"; }
						else if (sampleBallotVoterID % 5 == 2) { s = "My support for " + label(regretLoserID) + " was ultimately pointless. Oh well, at least we won!"; }
						else if (sampleBallotVoterID % 5 == 3) { s = "Glad we won, but looking back it was dangerous to also give points to " + label(regretLoserID) + "."; }
						else                                   { s = "If I knew how much support " + label(regretLoserID) + " was going to get, I actually won't have been so generous."; }
					} else {
						if      (sampleBallotVoterID % 5 == 0) { s = "Irritated that " + label(regretLoserID) + " almost won and I didn't do all I could to stop it."; }
						else if (sampleBallotVoterID % 5 == 1) { s = "str2"; }
						else if (sampleBallotVoterID % 5 == 2) { s = "str3"; }
						else if (sampleBallotVoterID % 5 == 3) { s = "str4"; }
						else                                   { s = "str5"; }
					}
				} */
				break;
			case "V321":
			case "Approval":
				if (soreLoser) {
					if (winnerScore > 0.5 && loserScore > 0.5) {
						if      (sampleBallotVoterID % 5 == 0) { s = "Why didn't I at least approve of " + label(regretLoserID) + "? Even they would have been better than " + label(regretWinnerID) + "..."; }
						else if (sampleBallotVoterID % 5 == 1) { s = "I could have approved " + label(regretLoserID) + " at least. D'oh!"; }
						else if (sampleBallotVoterID % 5 == 2) { s = "Guess none of my approvals mattered.  Should have approved " + label(regretLoserID) + " if I wanted to make a difference."; }
						else if (sampleBallotVoterID % 5 == 3) { s = "Wait, " + label(regretWinnerID) + " won? That's awful! Even " + label(regretLoserID) + " would have been better."; }
						else                                   { s = "Should have extended my support to " + label(regretLoserID) + " at least."; }
					} else {
						if      (sampleBallotVoterID % 5 == 0) { s = "Urg, why did I also approve " + label(regretWinnerID) + "? What a mistake!"; }
						else if (sampleBallotVoterID % 5 == 1) { s = "But I wanted " + label(regretLoserID) + " more than " + label(regretWinnerID) + "! Seeing the results, I regret supporting " + label(regretWinnerID) + " too."; }
						else if (sampleBallotVoterID % 5 == 2) { s = "My vote just let " + label(regretWinnerID) + " win instead of " + label(regretLoserID) + "..."; }
						else if (sampleBallotVoterID % 5 == 3) { s = "I guess that's what I get for being nice. You're welcome, " + label(regretWinnerID) + "."; }
						else                                   { s = "THOSE " + label(regretWinnerID) + "-SUPPORTING BASTARDS PLAYED US ALL FOR FOOLS!"; }
					}
				} /*else {
					if (winnerScore > 0.5 && loserScore > 0.5) {
						if      (sampleBallotVoterID % 5 == 0) { s = "Close call; I didn't do all I could to make sure " + label(regretLoserID) + " lost."; }
						else if (sampleBallotVoterID % 5 == 1) { s = "My guy never stood a chance; I should have focused on supporting everyone but " + label(regretLoserID) + " I guess."; }
						else if (sampleBallotVoterID % 5 == 2) { s = "Upset " + label(regretWinnerID) + " won, but the way things ended up I probably //should// have voted for them."; }
						else if (sampleBallotVoterID % 5 == 3) { s = "Kills me to say it, but I probably should have approved of " + label(regretWinnerID) + " just in case."; }
						else                                   { s = "At least " + label(regretLoserID) + " didn't win, but no thanks to me..."; }
					} else {
						if      (sampleBallotVoterID % 5 == 0) { s = "Glad we won, but looking back it was dangerous to also approve of " + label(regretLoserID) + "."; }
						else if (sampleBallotVoterID % 5 == 1) { s = "My support for " + label(regretLoserID) + " was ultimately pointless. Oh well, at least we won!"; }
						else if (sampleBallotVoterID % 5 == 2) { s = "It looks like " + label(regretLoserID) + " was actually " + label(regretWinnerID) + "'s biggest rival. Supporting them risked our victory."; }
						else if (sampleBallotVoterID % 5 == 3) { s = "It was risky to approve other candidates besides " + label(regretWinnerID) + ", and I now see that was a pointless risk."; }
						else                                   { s = "If I knew how much support " + label(regretLoserID) + " was going to get, I actually won't have approved of them too."; }
					}
				} */
				break;
			default:
				break;
		}
		cardinal_tooltip.append('p')
			.text('"' + s + '"')
			.attr("class", "sample-ballot-regret-message");
	}
}
function shuffle(array) {
	let currentIndex = array.length,  randomIndex;
	while (currentIndex != 0) {
		randomIndex = Math.floor(Math.random() * currentIndex);
		currentIndex--;
		[array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
	}
	return array;
}
function clearSampleBallotDispoTooltip() {
	cardinal_tooltip.transition()
		.duration(50)
		.style('opacity', '0');
	d3.select('#sample_ballot_arrow').transition()
		.duration(50)
		.style('opacity', '0');
}

let sankeyChart;
function loadSankeyChart(methodID, elimData) {
	if (elimData && elimData.length) {
		d3.select('#sankeyDescription').text(methodStrData[methodList[methodID]].sankey);
		sankeyChart = SankeyChart({ links: elimData }, {
			nodeGroup: d => d.id.split(/\W/)[0], // take first word for color
			format: (f => d => `${f(d)} TWh`)(d3.format(",.1~f")),
			width: 342,
			height: 28 + 50 * candidate_data.length
		});
	} else if (isMethodIDElimination(methodID)) {
		d3.select('#sankeyDescription').text(SANKEY_CONDORCET_STRING);
		d3.select('#sankey').selectAll("svg").remove();
	}  else {
		d3.select('#sankeyDescription').text(SANKEY_INVALID_STRING);
		d3.select('#sankey').selectAll("svg").remove();
	}
}

let isHideMethodsByDefault = false;
let expandedMethodList = [];
if (!isHideMethodsByDefault) {
	for (let parent in expandDict) {
		expandedMethodList.push(methodList.indexOf(parent));
	}
}

let methodTableState = null;
function initializeMethodTableBody() {
	if (methodTableState == displayMode) { return; }
	methodTableState = displayMode;
	let tbody = d3.select('#method_table_body');
	tbody.selectAll('tr').remove();
	
	for (let m = 0; m < methodList.length; m++) {
		let methodLabel = methodList[m];
		let tr = tbody.append('tr')
			.attr("class", isMethodIDCardinal(m) ? "cardinal-row" : null);
			tr.append('td').text(methodLabel).attr("class", "method-name")
			  //.on('click', toggleAllChildMethods)
			  .on('mouseover', methodMouseover)
			  .on('mouseout', methodMouseout);
		if (displayMode == "default") {
			tr.append('td');
			tr.append('td');
			tr.append('td').style("padding", 0);
			tr.append('td');
			tr.append('td');
		} else if (displayMode == "sim") {
			tr.append('td');
			tr.append('td');
			tr.append('td');
			tr.append('td');
			tr.append('td');
			tr.append('td');
			tr.append('td');
			tr.append('td');
			tr.append('td');
			tr.append('td');
			tr.append('td');
			tr.append('td');
			tr.append('td');
			tr.append('td');
		}
		if (isHideMethodsByDefault) {
			for (let parent in expandDict) {
				if (expandDict[parent].includes(methodLabel)) {
					hideMethodRow(m);
					continue;
				}
			}
		}
	}
}
let displayMode = "default";
function initializeMethodTableTHead() {
	let thead_tr = d3.select('#method_table').select('table').select('thead').select('tr');
	thead_tr.selectAll('td').remove();
	thead_tr.append('td').text("");
	if (displayMode == "sim") {
		d3.select("#body_wrapper").style("width", "2000px");
		d3.select("#method_table").style("width", "1240px");
		thead_tr.append('td').text("Majority Efficiency")
			.on('mouseover', e => displayInfoTooltip(e,
			["How frequently this method picks the Majority winner, if one exists.",
			 "(The candidate who got a true majority of 1st-place votes.)"]))
			.on('mouseout', clearInfoTooltip);
		thead_tr.append('td').text("Condorcet Efficiency")
			.on('mouseover', e => displayInfoTooltip(e,
			["How frequently this method picks the Condorcet winner, if one exists.",
			 "(The candidate who beats all the others 1v1.)"]))
			.on('mouseout', clearInfoTooltip);
		thead_tr.append('td').text("Condorcet Loser Efficiency")
			.on('mouseover', e => displayInfoTooltip(e,
			["How frequently this method picks the Condorcet loser, if one exists.",
			 "(The candidate who loses to all the others 1v1. Picking such a loser is a big failure!)"]))
			.on('mouseout', clearInfoTooltip);
		thead_tr.append('td').text("Strategy Present (Filtered)")
			.on('mouseover', e => displayInfoTooltip(e,
			["How frequently there exists a simple compromise+burial strategy that can allow at least one competitor to defeat the natural winner.",
			 "This excludes cyclical strategies that would be nullified by the self-interested 'gracious-withdrawl' of any third candidate that the strategy depends on exploiting.",
			 "This also excludes strategies which elect a third candidate whom most of the coalition does not actually favor (vs. original natural winner), but were tricked into accidently supporting.",
			]))
			.on('mouseout', clearInfoTooltip);
		thead_tr.append('td').text("Strategy Present (Unfiltered)")
			.on('mouseover', e => displayInfoTooltip(e,
			["This includes all simple strategies without the exclusions documented in the previous category."]))
			.on('mouseout', clearInfoTooltip);
		thead_tr.append('td').text("Alternative Strategy Present")
			.on('mouseover', e => displayInfoTooltip(e,
			["Independent occurence of additional simple strategies other than compromise/burial.",
			 "For partisan primaries, this includes up to 50% of voters disingenuously voting for poor candidates in the opposing primary. In low-turnout primaries, it is assumed that only voters already active in their own primary are willing to do this.",
			 "For Anti-Plurality-style methods, this includes spreading a coalition's last place votes tactically among all opponents.",
			 "For limited runoff methods, this includes running a single clone. (A teamed partner) Some cardinal runoff methods can achieve an identical effect by lending false support to a preferred runoff opponent in these cases.",
			 "Borda-style methods are possibly vulnerable to either (or both) of the latter two, but neither is computed here due to high computational complexity.",
			 "(Push-over strategies are not included due to their unrealistic nature and extreme odds of backfiring. They are reported instead as winner monotonic violations.)", ]))
			.on('mouseout', clearInfoTooltip);
		thead_tr.append('td').text("Utility Efficiency (Disposition3)")
			.on('mouseover', e => displayInfoTooltip(e,
			["How frequently this method picks the utility winner, as defined by an electorate all holding cardinal expression disposition '3'.",
			 "This is a slightly selfish disposition. Mathematically speaking, their normalized intrinsic ratings are expressed as r^(1/3)."]))
			.on('mouseout', clearInfoTooltip);
		thead_tr.append('td').text("Utility Efficiency (Disposition5)")
			.on('mouseover', e => displayInfoTooltip(e,
			["How frequently this method picks the utility winner, as defined by an electorate all holding cardinal expression disposition '5'.",
			 "This is an arguably neutral disposition. Mathematically speaking, their normalized intrinsic ratings are expressed linearly as r."]))
			.on('mouseout', clearInfoTooltip);
		thead_tr.append('td').text("Utility Efficiency (Disposition7)")
			.on('mouseover', e => displayInfoTooltip(e,
			["How frequently this method picks the utility winner, as defined by an electorate all holding cardinal expression disposition '7'.",
			 "This is a slightly compromising disposition. Mathematically speaking, their normalized intrinsic ratings are expressed as r^(3)."]))
			.on('mouseout', clearInfoTooltip);
		thead_tr.append('td').text("Simple Wasted Votes")
			.on('mouseover', e => displayInfoTooltip(e,
			["How many voters did not affect the outcome between the winner and closest runner-up, but wish they had--potentially regretting their vote.",
			 "Only final votes are considered; primaries are ignored.",
			 "For RawRange, since there are no ordinary bounds and all losing voters thus have *some* level of regret, instead shown is the cumulative magnitude of distance from each voter's ideal honest minmax ballot within the limits of the simulation."]))
			.on('mouseout', clearInfoTooltip);
		thead_tr.append('td').text("Winner Monotonic Violations")
			.on('mouseover', e => displayInfoTooltip(e,
			["Does any set of voters ranking a losing candidate lower make them win, or any set of voters ranking the winner higher make them lose?",
			"This is testing both forms of monotonicity violations, but filtered to cases that change the current winner."]))
			.on('mouseout', clearInfoTooltip);
		thead_tr.append('td').text("Third Party Winner")
			.on('mouseover', e => displayInfoTooltip(e,
			["Did a candidate besides A or B win, before strategy is attempted?",
			 "(This is disabled unless a 2-party clustering option is utilized.)"]))
			.on('mouseout', clearInfoTooltip);
		thead_tr.append('td').text("Winning Candidate Distance (Center)")
			.on('mouseover', e => displayInfoTooltip(e,
			["Average distance to center for winning candidates."]))
			.on('mouseout', clearInfoTooltip);
		thead_tr.append('td').text("Winning Candidate Disposition")
			.on('mouseover', e => displayInfoTooltip(e,
			["Average rating disposition of the winning candidate's supporters.",
			 "(Averaged such that each election is equal, not each winning voter.)"]))
			.on('mouseout', clearInfoTooltip);
	} else if (displayMode == "heatmap") {
	} else { // mode == "default"		
		//d3.select("#body_wrapper").style("width", "1360px");
		//d3.select("#method_table").style("width", "600px");
		thead_tr.append('td').text("Natural Winner")
			.on('mouseover', e => displayInfoTooltip(e,
			["This is the candidate who naturally wins, before any \"dishonest\" strategic vote is considered.",
			 "Cardinal methods do take into account disposition (how they translate/scale preferences into ratings), but never violate preference orderings. (\"Strategy\")"]))
			.on('mouseout', clearInfoTooltip);
		thead_tr.append('td').text("Natural Runner Up")
			.on('mouseover', e => displayInfoTooltip(e,
			["This is the candidate who naturally comes in second place, before any \"dishonest\" strategic vote is considered.",
			"Cardinal methods do take into account disposition (how they translate/scale preferences into ratings), but never violate preference orderings. (\"Strategy\")",
			 "Runoff or elimination based-methods report the other finalist, or last candidate eliminated.  Purely quantitative methods (including some handled this way like Ranked Pairs) report the 2nd-place candidate in their respective metric.  Other methods repeat the entire process anew on the remaining candidates."]))
			.on('mouseout', clearInfoTooltip);
		thead_tr.append('td').text("Strategy Vulnerability")
			.on('mouseover', e => displayInfoTooltip(e,
			["Which strategies successfully change the winner?",
			 "Mouse over any strategy for details."]))
			.on('mouseout', clearInfoTooltip);
		thead_tr.append('td').text("Simple Wasted Votes")
			.on('mouseover', e => displayInfoTooltip(e,
			["How many voters did not affect the outcome between the winner and closest runner-up, but wish they had--potentially regretting their vote.",
			 "Only final votes are considered; primaries are ignored.",
			 "For RawRange, since there are no ordinary bounds and all losing voters thus have *some* level of regret, instead shown is the cumulative magnitude of distance from each voter's ideal honest minmax ballot within the limits of the simulation."]))
			.on('mouseout', clearInfoTooltip);
		thead_tr.append('td').text("Winner Monotonic Violation")
			.on('mouseover', e => displayInfoTooltip(e,
			["Does any set of voters ranking a losing candidate lower make them win, or any set of voters ranking the winner higher make them lose?",
			"This is testing both forms of monotonicity violations, but filtered to cases that change the current winner."]))
			.on('mouseout', clearInfoTooltip);
		/*
		thead_tr.append('td').text("Dominant Strategic Winners")
			.on('mouseover', e => displayInfoTooltip(e,
			["Candidates who can defeat the natural winner if some amount of voters who prefer them (to the natural winner) strategically vote strongly for them and against the natural winner. (Some mix of \"Compromise\" and \"Bury\")",
			 "If done strongly enough, this strategy cannot be countered by the natural winner in any way."]))
			.on('mouseout', clearInfoTooltip);
		thead_tr.append('td').text("Reversible Strategic Winners")
			.on('mouseover', e => displayInfoTooltip(e,
			["Candidates who can defeat the natural winner if some amount of voters who prefer them (to the natural winner) strategically vote strongly for them and against the natural winner. (Some mix of \"Compromise\" and \"Bury\")",
			 "These strategies can always be successfully countered if enough voters who would rather support the natural winner respond in kind."]))
			.on('mouseout', clearInfoTooltip);
		thead_tr.append('td').text("Withdrawl-Dismissible Strategic Winners")
			.on('mouseover', e => displayInfoTooltip(e,
			["Candidates who can defeat the natural winner if some amount of voters who prefer them (to the natural winner) strategically vote strongly for them and against the natural winner. (Some mix of \"Compromise\" and \"Bury\")",
			 "These strategies can not only be successfully countered by voters, but also nullified entirely if other candidates are allowed to graciously withdraw after seeing the initial results. (Based purely on self-interest)"]))
			.on('mouseout', clearInfoTooltip);
		thead_tr.append('td').text("")
			.on('mouseover', e => displayInfoTooltip(e,
			[""]))
			.on('mouseout', clearInfoTooltip);
		thead_tr.append('td').text("")
			.on('mouseover', e => displayInfoTooltip(e,
			[""]))
			.on('mouseout', clearInfoTooltip);
		thead_tr.append('td').text("")
			.on('mouseover', e => displayInfoTooltip(e,
			[""]))
			.on('mouseout', clearInfoTooltip);
		thead_tr.append('td').text("")
			.on('mouseover', e => displayInfoTooltip(e,
			[""]))
			.on('mouseout', clearInfoTooltip);
		thead_tr.append('td').text("Strategic Kingmakers")
			.on('mouseover', e => displayInfoTooltip(e,
			["Candidates who, given a strong enough strategy rallying support against the natural winner, actually elect a different candidate entirely!",
			 "In these cases, most voters supporting the strategy prefer this new winner to the natural one."]))
			.on('mouseout', clearInfoTooltip);
		thead_tr.append('td').text("Strategic Backfires")
			.on('mouseover', e => displayInfoTooltip(e,
			["Candidates who, given a strong enough strategy rallying support against the natural winner, actually elect a different candidate entirely!",
			 "In these cases, most voters supporting the strategy preferred the natural winner to this new one..."]))
			.on('mouseout', clearInfoTooltip);
		thead_tr.append('td').text("Counterstrategic Backfires")
			.on('mouseover', e => displayInfoTooltip(e,
			["Candidates who, given a strong enough strategy rallying support against the natural winner AND a strong enough counter-rally in response, actually elect a third candidate!"]))
			.on('mouseout', clearInfoTooltip);
			*/
	}
}
initializeMethodTableBody();
initializeMethodTableTHead();

function clearMethodTableBody(isCardinalOnly = false) {
	if (displayMode != "default") {return;}
	if (isCardinalOnly) {
		d3.select('#method_table_body').selectAll(".cardinal-row").selectAll('td').filter(":not(.method-name)")
			.text("").attr("class", null)
			.style("background-color", null)
			.attr("id", null)
			.on('click', null)
			.on('mouseover', null)
			.on('mouseout', null);
	} else {
		d3.select('#method_table_body').selectAll('td').filter(":not(.method-name)")
			.text("").attr("class", null)
			.style("background-color", null)
			.attr("id", null)
			.on('click', null)
			.on('mouseover', null)
			.on('mouseout', null);
	}
}
function startDisplayingSimResults() {
	if (displayMode != "sim") {
		displayMode = "sim";
		initializeMethodTableTHead();
		initializeMethodTableBody();
	}
}

function hideMethodRow(methodID) {
	d3.select('#method_table_body').select('tr:nth-child(' + (methodID + 1) + ')').style("display", "none");
}
function showMethodRow(methodID) {
	d3.select('#method_table_body').select('tr:nth-child(' + (methodID + 1) + ')').style("display", null);
}
function hideAllChildMethods(methodID) {
	if (!expandDict.hasOwnProperty(methodList[methodID])) { return; }
	let children = expandDict[methodList[methodID]];
	for (let i = 0; i < children.length; i++) {
		let childIndex = methodList.indexOf(children[i]);
		hideMethodRow(childIndex);
	}
	//TODO: change collapse button to expand
	if (expandedMethodList.includes(methodID)) {
		expandedMethodList.splice(expandedMethodList.indexOf(methodID), 1);
	}
}
function showAllChildMethods(methodID) {
	if (!expandDict.hasOwnProperty(methodList[methodID])) { return; }
	let children = expandDict[methodList[methodID]];
	for (let i = 0; i < children.length; i++) {
		let childIndex = methodList.indexOf(children[i]);
		showMethodRow(childIndex);
	}
	//TODO: change expand button to collapse
	if (!expandedMethodList.includes(methodID)) {
		expandedMethodList.push(methodID);
	}
}
function toggleAllChildMethods(e) {	
	let methodID = methodList.indexOf(e.target.innerText);
	if (!expandDict.hasOwnProperty(methodList[methodID])) { return; }
	if (expandedMethodList.includes(methodID)) { hideAllChildMethods(methodID); }
	else									   { showAllChildMethods(methodID); }
}

function updateMethodTable(methodID) {
	if (displayMode != "default") {return;}
	let winner = MRDs[methodID].naturalWinner;
	let runnerUp = MRDs[methodID].runnerUp;
	
	
	let isMonotonicViolation = false;
	if        (MRDs[methodID]?.elimUMFData != null && MRDs[methodID].elimUMFData[winner] != null) {
		isMonotonicViolation = true;
	} else if (MRDs[methodID]?.elimDMFData != null && MRDs[methodID].elimDMFData[winner] != null) {
		isMonotonicViolation = true;
	}
	
	let tbody = d3.select('#method_table_body');
	let tr = tbody.select('tr:nth-child(' + (methodID + 1) + ')');
	tr.select('td:nth-child(2)').text(label(winner))
		.attr("class", e => getResultsColorClass(winner));
	tr.select('td:nth-child(3)').text(label(runnerUp))
		.attr("class", e => getResultsColorClass(runnerUp));
	tr.select('td:nth-child(4)').selectAll('svg').remove();
	let svg = tr.select('td:nth-child(4)').append('svg').attr("class", "strategy-token-svg");
	let xPosIndex = 0;
	for (let c = 0; c < candidate_data.length; c++) {
		if (c == winner) {xPosIndex++; continue;}
		if (candidate_data[c][5]) {continue;}
		let intensity = 0.2;
		let tooltipStrList = [];
		if        (MRDs[methodID].strategicDominantWinners.includes(c)) {
			intensity = 1.01;
			tooltipStrList = [label(winner) + " can be defeated by ranking them lower and/or compromising around " + label(c) + ". There is nothing " + label(winner) + " can do in response."];
		} else if (MRDs[methodID].strategicAntiPluralityWinners.includes(c)) {
			intensity = 1;
			tooltipStrList = [label(winner) + " can be defeated if " + label(c) + " spreads their last-place votes tactically among the other candidates. However, " + label(winner) + " (or other candidates) can probably do the same thing right back, resulting in an unstable outcome."];			
		} else if (MRDs[methodID].strategicCrossoverWinners.includes(c)) {
			intensity = 0.85;
			tooltipStrList = [label(winner) + " can be defeated if " + label(c) + " gathers compromise support from the opposing political party in the primary, from those voters who would genuinely prefer " + label(c) + " to " + label(winner) + "."];			
		} else if (MRDs[methodID].strategicAttackingPairs.hasOwnProperty(c)) {
			intensity = 0.75;
			let patsies = MRDs[methodID].strategicAttackingPairs[c];
			let patsyStr = "";
			if (patsies.length == 1) { patsyStr += label(patsies[0]); }
			else if (patsies.length == 1) { patsyStr += label(patsies[0]) + " or " + label(patsies[1]); }
			else {
				for (let p = 0; p < patsies.length - 1; p++) { patsyStr += label(patsies[p]) + ", ";}
				patsyStr += "or " + label(patsies[patsies.length-1]);
			}
			let message = label(winner) + " can be defeated by " + label(c) + " if enough of their supporters disingenuously support " + patsyStr + " in the opposing primary";
			if (c == runnerUp) { message += "."; }
			else               { message += " while also getting their own party to compromise around them."; }
			tooltipStrList = [message];			
		} else if (MRDs[methodID].strategicReversibleWinners.includes(c)) {
			intensity = 1;
			tooltipStrList = [label(winner) + " can be defeated by ranking them lower and/or compromising around " + label(c) + ". However, " + label(winner) + " wins if they retaliate with an identical counter-strategy, promoting a two-party status quo."];
		} else if (MRDs[methodID].strategicCloneWinners.includes(c)) {
			intensity = 0.7;
			let isThree = methodList[methodID] == "STAR3";
			tooltipStrList = [label(c) + "'s supporters would be able to defeat " + label(winner) + " if they simply had " + (isThree ? "three" : "two") + " teamed candidates to seize " + (isThree ? "all three" : "both") + " spots in the runoff.  This could be " + (isThree ? "clones" : "a clone") + " of " + label(c) + " added to the race, or possibly a similar-enough existing candidate."];
		} else if (c in MRDs[methodID].strategicWithdrawVulnerableWinners) {
			intensity = 0.5;
			tooltipStrList = ["While with enough manipulation " + label(c) + " can create a cycle against " + label(winner) + " involving " + label(MRDs[methodID].strategicWithdrawVulnerableWinners[c]) + ", the cycle is null and " + label(winner) + " always remains the winner if all candidates who prefer " + label(winner) + " to " + label(c) + " are permitted to concede and withdraw."];
		} else if (MRDs[methodID].strategicBackfires.map(e => e[0]).includes(c)) {
			let outcome;
			for (let i = 0; i < MRDs[methodID].strategicBackfires.length; i++) {
				if (MRDs[methodID].strategicBackfires[i][0] == c) {outcome = MRDs[methodID].strategicBackfires[i]; break;}
			}
			intensity = 0.4 + outcome[2] * 0.4;
			tooltipStrList = ["Attempting to compromise around  " + label(c) + " can defeat " + label(winner) + " but elects " + label(outcome[1]) + " instead. This is a preferred outcome (compared to " + label(winner) + ") for " + ((outcome[2] < 0.5 && outcome[2] > 0.01) ? "only " : "") + (outcome[2]*100).toFixed(0) + "% of those who originally rallied behind " + label(c) + "."];
		} else {
			tooltipStrList = ["No compromise based around " + label(c) + " can defeat " + label(winner) + "."];
		}
		addStrategyToken(svg, c, xPosIndex, intensity, tooltipStrList);
		xPosIndex++;
	}
	tr.select('td:nth-child(5)').text((MRDs[methodID].wastedVotes/voter_data.length*100).toFixed(2)+'%')
		.style("background-color", d3.interpolateReds((MRDs[methodID].wastedVotes/voter_data.length)**0.5*0.8))
		.attr("id", 'regret_' + methodID + '_' + winner + '_' + MRDs[methodID].runnerUp)
		.on('click',     MRDs[methodID].wastedVotes == 0 ? null : mouseoverRegret)
		.on('mouseover', MRDs[methodID].wastedVotes == 0 ? null : mouseoverRegret)
		.on('mouseout',  MRDs[methodID].wastedVotes == 0 ? null : mouseoutRegret);
	tr.select('td:nth-child(6)').text(isMonotonicViolation ? (isMethodIDCondorcet(methodID) ? "Partial" : "Yes") : "No")
		.style("background-color", isMonotonicViolation ? (isMethodIDCondorcet(methodID) ? "#eeccaa" : "#ff9999") : null)
		.attr("id", 'monotonic_' + methodID+ '_' + winner)
		.on('click',     isMonotonicViolation ? mouseoverMonotonic : null)
		.on('mouseover', isMonotonicViolation ? mouseoverMonotonic : null)
		.on('mouseout',  isMonotonicViolation ? mouseoutMonotonic  : null);
	//tr.select('td:nth-child(3)').text(list2labels(MRDs[methodID].strategicDominantWinners));
	//tr.select('td:nth-child(4)').text(list2labels(MRDs[methodID].strategicReversibleWinners));
	//tr.select('td:nth-child(5)').text(list2labels(MRDs[methodID].strategicWithdrawVulnerableWinners));
	//tr.select('td:nth-child(6)').text(list2labelPairs(MRDs[methodID].strategicKingmakers));
	//tr.select('td:nth-child(7)').text(list2labelPairs(MRDs[methodID].strategicBackfires));
	//tr.select('td:nth-child(8)').text(list2labelPairs(MRDs[methodID].strategicCounterstrategyBackfires));
}
function getResultsColorClass(candidateID) {
	if (candidateID == baseCARS.condorcetWinner) { return "result-highlight-conW"; }
	if (candidateID == baseCARS.condorcetLoser)  { return "result-highlight-conL"; }
	return "result-highlight-" + baseCARS.sortedWins.indexOf(candidateID);
}
function updateMethodSimTable(vCat = "All", vCount = -1, cCount = -1, clusters = -1,
                              majorityInclude = true, condorcetInclude = true, //non-majority condorcet only
	                          cycle3Include = true, cyclePlusInclude = true,
	                          methodID = -1) { //-1 for all methods
	if (displayMode != "sim") {return;}
	
	let myData = simResults.filter( e => (vCat == "All"  || e.vCat == vCat) &&
	                                     (vCount == -1   || e.vCount == vCount) &&
	                                     (cCount == -1   || e.cCount == cCount) &&
	                                     (clusters == -1 || e.clusters == clusters) &&
	                                     !(!majorityInclude  && e.majority != null) &&
	                                     !(!condorcetInclude && e.conWin   != null && e.majority == null) &&
	                                     !(!cycle3Include    && e.smithSet.length == 3) &&
	                                     !(!cyclePlusInclude && e.smithSet.length >  3));

	let isThirdPartyRelevant = parseInt(document.querySelector('#simCandidateClustering').value) < 0;
	for (let m = 0; m < methodList.length; m++) {
		if (methodID > -1 && methodID != m) {continue;}
		
		let majWinTotal = 0;
		let majWinCount = 0;
		let conWinTotal = 0;
		let conWinCount = 0;
		let conLoseTotal = 0;
		let conLoseCount = 0;
		let stratTotal = 0;
		let filteredStratCount = 0;
		let unfilteredStratCount = 0;
		let alternateStratCount = 0;
		let util3WinCount = 0;
		let util5WinCount = 0;
		let util7WinCount = 0;
		let votesTotal = 0;
		let wastedVotesCount = 0;
		let monotonicViolationCount = 0;
		let thirdPartyWins = 0;
		let totalWinnerDistance = 0;
		let totalWinnerDispo = 0;
		for (let i = 0; i < myData.length; i++) {
			let trial = myData[i];
			let q = trial.MRDs[m];
			if (trial.majority != null) {
				majWinTotal++;
				if (trial.majority == q.naturalWinner) {majWinCount++;}
			}
			if (trial.conWin != null) {
				conWinTotal++;
				if (trial.conWin == q.naturalWinner) {conWinCount++;}
			}
			if (trial.conLose != null) {
				conLoseTotal++;
				if (trial.conLose == q.naturalWinner) {conLoseCount++;}
			}
			stratTotal++;
			if (q.strategicDominantWinners.length > 0 ||
			    q.strategicReversibleWinners.length > 0 ||
				q.strategicCrossoverWinners.length > 0) {
				filteredStratCount++;
				unfilteredStratCount++;
			} else if (Object.keys(q.strategicWithdrawVulnerableWinners).length > 0) {
				unfilteredStratCount++;
			} else if (q.strategicBackfires.length > 0) {
				for (let j = 0; j < q.strategicBackfires.length; j++) {
					if (q.strategicBackfires[2] > 0.5) { unfilteredStratCount++; break; }
				}
			}
			if (q.strategicAntiPluralityWinners.length > 0 ||
				q.strategicCloneWinners.length > 0 ||
				Object.keys(q.strategicAttackingPairs).length > 0) {
				alternateStratCount++;
			}
			if (trial.util3Win == q.naturalWinner) {util3WinCount++;}
			if (trial.util5Win == q.naturalWinner) {util5WinCount++;}
			if (trial.util7Win == q.naturalWinner) {util7WinCount++;}
			votesTotal += trial.vCount;
			wastedVotesCount += q.wastedVotes;
			if        (q?.elimUMFData != null && q.elimUMFData[q.naturalWinner] != null) {
				monotonicViolationCount++;
			} else if (q?.elimDMFData != null && q.elimDMFData[q.naturalWinner] != null) {
				monotonicViolationCount++;
			}
			if (q.naturalWinner > 1) {thirdPartyWins++;}
			totalWinnerDistance += trial.distances[q.naturalWinner];
			totalWinnerDispo += trial.dispos[q.naturalWinner];
		}
		
		
		let tbody = d3.select('#method_table_body');
		let tr = tbody.select('tr:nth-child(' + (m + 1) + ')');
		tr.select('td:nth-child(2)').text(majWinTotal == 0 ? '-' : (majWinCount/majWinTotal*100).toFixed(2) + '%')
			.attr("class", null)
			.style("background-color", d3.interpolateRdBu(majWinTotal == 0 ? 0.25 :
			                                              Math.max(0.1,-0.25 + (0.5+majWinCount/majWinTotal/2)**4)))
			.style("font-weight", majWinCount == majWinTotal ? "bold" : null);
		tr.select('td:nth-child(3)').text(conWinTotal == 0 ? '-' : (conWinCount/conWinTotal*100).toFixed(2) + '%')
			.style("background-color", d3.interpolateRdBu(conWinTotal == 0 ? 0.25 :
			                                              Math.max(0.1,-0.25 + (0.5+conWinCount/conWinTotal/2)**4)))
			.style("font-weight", conWinCount == conWinTotal ? "bold" : null);
		tr.select('td:nth-child(4)').text(conLoseTotal == 0 ? '-' : (conLoseCount/conLoseTotal*100).toFixed(2) + '%')
			.style("background-color", d3.interpolateReds((conLoseCount/conLoseTotal)**0.1*0.8));
		let fStrat = filteredStratCount/stratTotal;
		let uStrat = unfilteredStratCount/stratTotal;
		let aStrat = alternateStratCount/stratTotal;
		tr.select('td:nth-child(5)').text(stratTotal == 0 ? '-' : (fStrat*100).toFixed(2) + '%')
			.style("font-weight", filteredStratCount == 0 ? "bold" : null);
		if (fStrat < 0.5) {
			tr.select('td:nth-child(5)').style("color", null)
				.style("background-color", d3.interpolateSpectral(0.9-fStrat*1.8));
		} else {
			tr.select('td:nth-child(5)').style("color", '#eeeeee')
				.style("background-color", d3.interpolateRgb(d3.interpolateSpectral(1.0), "black")(fStrat/2));
		}
		tr.select('td:nth-child(6)').text(stratTotal == 0 ? '-' : (uStrat*100).toFixed(2) + '%')
			.style("font-weight", unfilteredStratCount == 0 ? "bold" : null);
		if (uStrat < 0.5) {
			tr.select('td:nth-child(6)').style("color", null)
				.style("background-color", d3.interpolateSpectral(0.9-uStrat*1.8));
		} else {
			tr.select('td:nth-child(6)').style("color", '#eeeeee')
				.style("background-color", d3.interpolateRgb(d3.interpolateSpectral(1.0), "black")(uStrat/2));
		}
		tr.select('td:nth-child(7)').text(alternateStratCount == 0 ? '-' : (aStrat*100).toFixed(2) + '%');
		if (aStrat < 0.5) {
			tr.select('td:nth-child(7)').style("color", null)
				.style("background-color", d3.interpolateSpectral(0.9-aStrat*1.8));
		} else {
			tr.select('td:nth-child(7)').style("color", '#eeeeee')
				.style("background-color", d3.interpolateRgb(d3.interpolateSpectral(1.0), "black")(aStrat/2));
		}
		tr.select('td:nth-child(8)').text(stratTotal == 0 ? '-' : (util3WinCount/stratTotal*100).toFixed(2) + '%')
			.style("background-color", d3.interpolateRdYlGn(-0.25 + (util3WinCount/stratTotal)**3));
		tr.select('td:nth-child(9)').text(stratTotal == 0 ? '-' : (util5WinCount/stratTotal*100).toFixed(2) + '%')
			.style("background-color", d3.interpolateRdYlGn(-0.25 + (util5WinCount/stratTotal)**3));
		tr.select('td:nth-child(10)').text(stratTotal == 0 ? '-' : (util7WinCount/stratTotal*100).toFixed(2) + '%')
			.style("background-color", d3.interpolateRdYlGn(-0.25 + (util7WinCount/stratTotal)**3));
		tr.select('td:nth-child(11)').text(votesTotal == 0 ? '-' : (wastedVotesCount/votesTotal*100).toFixed(2) + '%')
			.style("background-color", d3.interpolateReds((wastedVotesCount/votesTotal)**0.5*0.8))
			.attr("id", null)
			.on('mouseover', null)
			.on('mouseout', null);
		tr.select('td:nth-child(12)').text(stratTotal == 0 ? '-' : (monotonicViolationCount/stratTotal*100).toFixed(2) + '%')
			.style("background-color", d3.interpolateReds((monotonicViolationCount/stratTotal)**0.5*0.8))
			.attr("id", null)
			.on('mouseover', null)
			.on('mouseout', null);
		tr.select('td:nth-child(13)').text(stratTotal == 0  || (!isThirdPartyRelevant) ? '-' : (thirdPartyWins/stratTotal*100).toFixed(2) + '%')
			.style("background-color", d3.interpolateGreens(isThirdPartyRelevant ? (thirdPartyWins/stratTotal)**0.5 : 0));
		tr.select('td:nth-child(14)').text(stratTotal == 0 ? '-' : (totalWinnerDistance/stratTotal).toFixed(3))
			.style("background-color", d3.interpolateOranges((totalWinnerDistance/stratTotal)/3));
		tr.select('td:nth-child(15)').text(stratTotal == 0 ? '-' : (totalWinnerDispo/stratTotal).toFixed(3))
			.style("background-color", d3.interpolatePurples((totalWinnerDispo/stratTotal)/10));
	}
}

function methodMouseover(e) {
	let methodID = methodList.indexOf(e.target.innerText);
	displaySankey(methodID, true);
	displayInfoTooltipDetailed(e, methodStrData[e.target.innerText].title,
	                              methodStrData[e.target.innerText].aka,
	                              methodStrData[e.target.innerText].stringList);
	if (isMethodIDLowTurnout(methodID)) {
		startHighlightLowTurnout();
	}
	if (isHeatmapActive) { update_heatmap(methodID); }
}
function methodMouseout(e) {
	let methodID = methodList.indexOf(e.target.innerText);
	clearInfoTooltip();
	if (isMethodIDLowTurnout(methodID)) {
		endHighlight();
	}
}
function mouseoverMonotonic(e) {
	let params = e.target.id.split('_');
	let methodID = parseInt(params[1]);
	let winnerID = parseInt(params[2]);
	let strs = [];
	
	if (isMethodIDElimination(methodID)) {
		displaySankey(methodID, false);
		openTab("sankey_tab");
	}
	
	let data = MRDs[methodID]?.elimUMFData != null ? MRDs[methodID]?.elimUMFData[winnerID] : null;
	if (data != null) {
		for (let b in data) { for (let c in data[b]) {
			if (isMethodIDPartisan(methodID)) {
				strs.push(label(winnerID) + "'s victory is counting on " + label(b) + " winning the primary over " + label(c) + ". (Who would beat " + label(winnerID) + " in the general) If at least " + data[b][c][0] + " " + label(b) + " supporters voted in the other primary instead--even for " + label(winnerID) + "--then " + label(winnerID) + " would lose.");
			} else if (methodList[methodID] == "Coombs") {
				strs.push(label(winnerID) + " is currently counting on insufficient " + label(b) + " hatred allowing " + label(c) + " to be eliminated first. If exactly between " + data[b][c][0] + "-" + data[b][c][1] + " " + label(winnerID) + " haters change their votes to rank " + label(b) + " lower than " + label(winnerID) + ", " + label(c) + " would win as they are no longer eliminated early.");
			} else {
				strs.push(label(winnerID) + " is currently counting on " + label(b) + " to eliminate " + label(c) + ". If exactly between " + data[b][c][0] + "-" + data[b][c][1] + " " + label(b) + " supporters change their votes to rank " + label(winnerID) + " higher than " + label(b) + ", " + label(c) + " would win as they are no longer eliminated early.");
			}
		}}
	}
	data = MRDs[methodID]?.elimDMFData != null ? MRDs[methodID]?.elimDMFData[winnerID] : null;
	if (data != null) {
		for (let b in data) { for (let c in data[b]) {
			if (isMethodIDPartisan(methodID)) {
				strs.push("While " + label(c) + " could not defeat " + label(winnerID) + ", they could defeat " + label(b) + " if " + label(b) + " had won that primary instead. If at least " + data[b][c][0] + " " + label(c) + " supporters instead voted in the other primary to help " + label(b) + " defeat " + label(winnerID) + ", then " + label(c) + " could ultimately win.");
			} else if (methodList[methodID] == "Coombs") {
				strs.push(label(winnerID) + " only avoided early elimination by " + data[b][c][0] + " votes compared to " + label(b) + ". But while " + label(c) + " could not ultimately defeat " + label(winnerID) + ", they could defeat " + label(b) + " if it came down to them instead. If exactly between " + data[b][c][0] + "-" + data[b][c][1] + " " + label(b) + " haters change their votes to rank " + label(c) + " higher than " + label(b) + ", " + label(winnerID) + " would be eliminated early and " + label(c) + " would win.");
			} else {
				strs.push(label(winnerID) + " only avoided early elimination by " + data[b][c][0] + " votes compared to " + label(b) + ". But while " + label(c) + " could not ultimately defeat " + label(winnerID) + ", they could defeat " + label(b) + " if it came down to them instead. If exactly between " + data[b][c][0] + "-" + data[b][c][1] + " " + label(c) + " supporters change their votes to rank " + label(b) + " lower than " + label(c) + ", " + label(winnerID) + " would be eliminated early and " + label(c) + " would win.");
			}
		}}
	}
	if (isMethodIDCondorcet(methodID)) {
		strs.push("However, this is only true while these vote changes do not break the current Condorcet cycle; it may even be impossible.");
	}
	displayInfoTooltip(e, strs);
	//showSampleBallotDispoTooltip(-1, true, regretWinnerID, regretLoserID, methodID);
	//updateHexbinQuick(regretWinnerID, regretLoserID, "Regret", methodID);
}
function mouseoutMonotonic() {
	clearInfoTooltip();
	clearSampleBallotDispoTooltip();
	updateHexbinQuick();
}
function mouseoverRegret(e) {
	if (isHeatmapActive) {return;}
	let params = e.target.id.split('_');
	let methodID = parseInt(params[1]);
	let regretWinnerID = parseInt(params[2]);
	let regretLoserID = parseInt(params[3]);
	if (isMethodIDCardinal(methodID)) {
		openTab("cardinal_tab");
	}
	showSampleBallotDispoTooltip(-1, true, regretWinnerID, regretLoserID, methodID);
	updateHexbinQuick(regretWinnerID, regretLoserID, "Regret", methodID);
}
function mouseoutRegret() {
	clearSampleBallotDispoTooltip();
	updateHexbinQuick();
}

function displaySankey(methodID, isReset) {
	currentlySelectedSankeyMethod = methodID;
	if (isMethodIDElimination(methodID)) {
		if (methodID in MRDs && MRDs[methodID] && MRDs[methodID].elimData && MRDs[methodID].elimData.length) {
			loadSankeyChart(methodID, MRDs[methodID].elimData);
		} else {
			d3.select('#sankeyDescription').text(SANKEY_CONDORCET_STRING);
			d3.select('#sankey').selectAll("svg").remove();
		}
	} else if (isReset) {
		d3.select('#sankeyDescription').text(SANKEY_INVALID_STRING);
		d3.select('#sankey').selectAll("svg").remove();
	}
}

function addStrategyToken(parentSVGSelection, candidateID, index, intensity, tooltipStrList) {
	let myR = CANDIDATE_RADIUS * 0.75;
	let offsetX = (6-candidate_data.length) * (myR+1) + 3;
	let inner = parentSVGSelection.append('g')
		.attr("transform", d => "translate(" + (offsetX + (2*index+1)*(myR+2)) + "," + (myR+1) + ")")
		.attr("opacity", intensity)
		.on('mouseover', e => displayInfoTooltip(e, tooltipStrList))
		.on('mouseout', clearInfoTooltip);
		
	inner.append("circle")
		.attr("r", myR)
		.attr("fill", d => d3.interpolateRgb(d3.schemeCategory10[candidateID], "grey")(1 - intensity))
		.attr("stroke", "black");
		
	inner.append("text")
		.text(d => label(candidateID))
		.attr("dx", -4)
		.attr("dy", 4)
		.style("font-size", 14)
		.style("font-weight", intensity > 1 ? "bold" : null);
}

function displayInfoTooltip(e, stringList) {
	displayInfoTooltipDetailed(e, null, null, stringList);
}
function displayInfoTooltipDetailed(e, boldString, italicsString, stringList) {
	info_tooltip
		.style("left", "0px")
		.style("top", "0px")
		.style("min-width", "0px")
		.selectAll("p").remove();
	if (boldString) {
		info_tooltip.append("p").attr("class","title").text(boldString);
	}
	if (italicsString) {
		info_tooltip.append("p").attr("class","aka").text(italicsString);
	}
	if (stringList) {
		for (let i = 0; i < stringList.length; i++) {
			info_tooltip.append("p").text(stringList[i]);
		}
	}
	let tooltip_rect = info_tooltip_DOM.getBoundingClientRect();
	let tooltipW = tooltip_rect.width;
	let tooltipH = tooltip_rect.height;
	
	info_tooltip
		.style("left", (e.x + 20) + "px")
		.style("top", (e.y - 10) + "px")
		.style("min-width", tooltipW + "px")
	tooltip_rect = info_tooltip_DOM.getBoundingClientRect();
	
	let w = window.innerWidth;
	let h = window.innerHeight;
	if (tooltip_rect.left + tooltipW > w - 25) {
		info_tooltip.style("left", (w + window.scrollX + 0 - tooltipW - 25) + "px");
	}
	if (tooltip_rect.top < 68) {
		info_tooltip.style("top", 68 + "px");
	} else if (tooltip_rect.top + tooltipH > h - 20) {
		info_tooltip.style("top", (h - tooltipH - 20) + "px");
	}
	info_tooltip.raise()
		.transition()
		.duration('50')
		.style("opacity", 1);
}
function clearInfoTooltip() {
	info_tooltip.transition()
		.duration('50')
		.style("opacity", 0);
}
function updateInfoTooltip(stringList)
{
	info_tooltip.selectAll("p").remove();
	for (let i = 0; i < stringList.length; i++) {
		info_tooltip.append("p").text(stringList[i]);
	}
}

function initializeCorrelationTable() {
	let thead_tr = d3.select('#correlation_table').select('table').select('thead').select('tr');
	thead_tr.selectAll('td').remove();
	thead_tr.append('td').text("");
	
	for (let m = 0; m < methodList.length; m++) {
		thead_tr.append('td').text(methodList[m])
			.attr("class", "vertical-method-name");
	}

	let tbody = d3.select('#correlation_table_body');
	for (let m = 0; m < methodList.length; m++) {
		let tr = tbody.append('tr');
		tr.append('td').text(methodList[m])
			.attr("class", "method-name");
		for (let n = 0; n < methodList.length; n++){
			tr.append('td').attr("class", m == n ? "grid-null" : null);
		}
	}
}
initializeCorrelationTable();

function clearCorrelationTableBody() {
	d3.select('#correlation_table_body').selectAll('td').filter(":not(.method-name)")
		.text("").attr("class", null);
}
function updateCorrelationTable(vCat = "All", vCount = -1, cCount = -1, clusters = -1,
                                majorityInclude = true,  //include elections with a majority winner?
								condorcetInclude = true, //include elections with a non-majority condorcet winner?
	                            cycle3Include = true,     //include elections with a 3-way condorcet cycle?
								cyclePlusInclude = true,  //include elections with a 4+way condorcet cycle?
	                            methodID = -1) { //-1 for all methods
	if (displayMode != "sim") {return;}
	
	let myData = simResults.filter( e => (vCat == "All"  || e.vCat == vCat) &&
	                                     (vCount == -1   || e.vCount == vCount) &&
	                                     (cCount == -1   || e.cCount == cCount) &&
	                                     (clusters == -1 || e.clusters == clusters) &&
	                                     !(!majorityInclude  && e.majority != null) &&
	                                     !(!condorcetInclude && e.conWin   != null && e.majority == null) &&
	                                     !(!cycle3Include    && e.smithSet.length == 3) &&
	                                     !(!cyclePlusInclude && e.smithSet.length >  3));

	let tbody = d3.select('#correlation_table_body');
	for (let m = 0; m < methodList.length; m++) {
		if (methodID > -1 && methodID != m) {continue;}
		let tr = tbody.select('tr:nth-child(' + (m + 1) + ')');
		for (let n = 0; n < methodList.length; n++) {
			if (m == n) { continue; }
			let total = 0;
			let count = 0;
			for (let i = 0; i < myData.length; i++) {
				let trial = myData[i];
				total++;
				if (trial.MRDs[m].naturalWinner == trial.MRDs[n].naturalWinner) { count++; }
			}
			let num = (count/total*100).toFixed(1);
			tr.select('td:nth-child(' + (n + 2) + ')').text((num == 100 ? 100 : num) + '%')
				.style("background-color", d3.interpolatePuOr(0.75 - (count/total)**2/2)); 
		}
	}
}

function clearResultsCache() {
	baseCARS_cache = {};
	MRDs_cache = {};
}
function getResultsCacheKey() {
	let cacheKey = "";
	for (let c = 0; c < candidate_data.length; c++) {
		if (!candidate_data[c][5]) { cacheKey += label(c) + candidate_data[c][4]; }
	}
	return cacheKey;
}

let isFullWorkerRequestActive = false;
let worker;
function startWorker(isCardinalOnly = false, allowCache = false) {
	let cacheKey = getResultsCacheKey();
	if (isFullWorkerRequestActive) { isCardinalOnly = false; } //if old worker was a full request, new must do its job
	if (!isCardinalOnly) { isFullWorkerRequestActive = true; }
	if (worker != null) { worker.terminate();}
	
	if (allowCache) {
		if (cacheKey in baseCARS_cache && cacheKey in MRDs_cache) {
			baseCARS = baseCARS_cache[cacheKey];
			updateResultsTable();
			updateUtilityWinnerTable();
			updateCardinalTable(isCardinalOnly);
			for (let m = 0; m < methodList.length; m++) {
				if (isCardinalOnly && !isMethodIDCardinal(m)) {continue;}
				MRDs[m] = MRDs_cache[cacheKey][m];
				updateMethodTable(m);
			}
			loadSankeyChart(MRDs[currentlySelectedSankeyMethod].elimData);
			isFullWorkerRequestActive = false;
			return;
		}
	} else {
		clearResultsCache();
	}
	
	worker = new Worker('votesim_worker.js', {type: 'module'});
	worker.postMessage({voter_data: voter_data,
	                    candidate_data: candidate_data,
						isCardinalOnly: isCardinalOnly,
						cacheKey: cacheKey});
	worker.onmessage = function(event) {
		switch (event.data.kind) {
			case "baseCARS-creation":
				if (event.data.isCardinalOnly == true) { break; }
				baseCARS = event.data.data;
				updateResultsTable();
				break;
			case "baseCARS-analysis":
				baseCARS = event.data.data;
				updateResultsTable();
				updateUtilityWinnerTable();
				updateCardinalTable(event.data.isCardinalOnly == true);
				break;
			case "stratCARS":
				console.log(event.data.data);
				break;
			case "runnerUpCARS":
				console.log(event.data.data);
				break;
			case "smithCARS":
				console.log(event.data.data);
				break;
			case "MRD":
				if (event.data.cacheKey != getResultsCacheKey()) { console.log(event.data.cacheKey); break; }
				let methodID = event.data.data.methodID;
				MRDs[methodID] = event.data.data;
				updateMethodTable(methodID);
				if (currentlySelectedSankeyMethod == methodID) {
					loadSankeyChart(methodID, event.data.data.elimData);
				}
				if (isHeatmapActive && candidateCount > heatmapCandidateCount && methodID == heatmap_current_methodID) {
					update_heatmap_legend();
				}
				if (isLastMethod(methodID)) {
					isFullWorkerRequestActive = false;
					baseCARS_cache[cacheKey] = baseCARS;
					if (!(cacheKey in MRDs_cache)) { MRDs_cache[cacheKey] = {}; }
					for (let m = 0; m < methodList.length; m++) {
						MRDs_cache[cacheKey][m] = MRDs[m];
					}
				}
				break;
			default:
				break;
		}
	};
}
function isLastMethod(methodID) {
	return isFullWorkerRequestActive ? methodID == methodList.length - 1 :
	                                   methodList[methodID] == "Smith//STAR";
}
function terminateWorker() { if (worker != null) {worker.terminate(); worker = null;} }
startWorker();

const WORKER_COUNT = Math.max(1, navigator.hardwareConcurrency / 2 - 1);
const NORMAL_UPDATE_PERIOD = 300; //milliseconds
let simResults = [];
let simWorkers = [];
function startSimWorkers(simCount,
                         voterCategory = "Normal",
                         voterCount = 10000,
                         candidateCount = 3,
                         numberOfClusterIterations = 0,
                         lowerDispoBound = 4,
                         upperDispoBound = 6) {
	if (isSimRunning) { endSimulation(); return;}
	isSimRunning = true;
	d3.select("#return_button").style("display", null);
	d3.select('#simStatus').text('0/' + simCount + " complete");
	d3.select('#simResults_MAJ').text("Majority Winner: 0%");
	d3.select('#simResults_CON').text("Non-Majority Condorcet Winner: 0%");
	d3.select('#simResults_CY3').text("3-Way Cycle: 0%");
	d3.select('#simResults_CYB').text("Bigger Cycle: 0%");
	
	simResults = [];
	if (worker != null) { worker.terminate();}
	for (let sw = simWorkers.length - 1; sw > -1; sw--) {
		simWorkers[sw].terminate();
	}
	simWorkers = [];
	
	startDisplayingSimResults();
	let workerCount = WORKER_COUNT;
	while (simCount % workerCount != 0) {simCount++;}
	for (let w = 0; w < workerCount; w++)
	{
		let simWorker = new Worker('votesim_worker.js', {type: 'module'});
		simWorkers.push(simWorker);
		simWorker.postMessage({simCount: simCount / workerCount, voterCategory: voterCategory, voterCount: voterCount,
		                      candidateCount: candidateCount, numberOfClusterIterations: numberOfClusterIterations,
		                      lowerDispoBound: lowerDispoBound, upperDispoBound: upperDispoBound,
		                      batchUpdatePeriod: workerCount * NORMAL_UPDATE_PERIOD,
		                      batchUpdateOffset: w * NORMAL_UPDATE_PERIOD});
		simWorker.onmessage = function(event) {
			for (let i = 0; i < event.data.pendingResultsQueue.length; i++) {
				simResults.push(event.data.pendingResultsQueue[i]);
			}
			d3.select('#simStatus').text(simResults.length + '/' + simCount + " complete");
			d3.select('#simResults_MAJ').text("Majority Winner: " +
				(simResults.filter(e => e.majority != null).length / simResults.length *100).toFixed(2) + '%');
			d3.select('#simResults_CON').text("Non-Majority Condorcet Winner: " +
				(simResults.filter(e => e.majority == null && e.conWin != null).length / simResults.length *100).toFixed(2) + '%');
			d3.select('#simResults_CY3').text("3-Way Cycle: " +
				(simResults.filter(e => e.smithSet.length == 3).length / simResults.length *100).toFixed(2) + '%');
			d3.select('#simResults_CYB').text("Bigger Cycle: " +
				(simResults.filter(e => e.smithSet.length > 3).length / simResults.length *100).toFixed(2) + '%');
			updateMethodSimTable();
			if (document.querySelector('#simCorrelationCheckbox').checked) {
				d3.select('#correlation_table').style("display", null);
				updateCorrelationTable();
			} else {
				d3.select('#correlation_table').style("display", "none");
			}
			if (document.querySelector('#simAnimationCheckbox').checked) {
				simCandidateAnimation();
			}
			if (simResults.length == simCount) {
				endSimulation();
			}
			
		};
	}
}
function startSimWorkersHeatmap(simCount, newDispo) {
	if (isSimRunning) { endSimulation(); return;}
	isSimRunning = true;
	d3.select("#return_button").style("display", null);
	currentHeatmapResolution = Math.round(Math.sqrt(simCount));
	updateContourParams();
	simCount = currentHeatmapResolution * currentHeatmapResolution;	
	
	d3.select('#heatmapSimStatus').text('0/' + simCount + " complete");
	
	simResults = [];
	if (worker != null) { worker.terminate();}
	for (let sw = simWorkers.length - 1; sw > -1; sw--) {
		simWorkers[sw].terminate();
	}
	simWorkers = [];
	
	//startDisplayingSimResults();
	let workerCount = WORKER_COUNT;
	let simsPerWorker = Math.ceil(simCount / workerCount);
	for (let w = 0; w < workerCount; w++)
	{		
		let mySimCount = (w < workerCount - 1) ? simsPerWorker : simCount - simsPerWorker * (workerCount - 1);
		let simWorker = new Worker('votesim_worker.js', {type: 'module'});
		simWorkers.push(simWorker);
		simWorker.postMessage({simCount: mySimCount, heatmapIndexOffset: w*simsPerWorker,
		                       heatmapResolution: currentHeatmapResolution, heatmapMarginX: heatmapMarginX, heatmapMarginY: heatmapMarginY, 
		                       voter_data: voter_data, candidate_data: candidate_data, newDispo: newDispo,
		                       batchUpdatePeriod: workerCount * NORMAL_UPDATE_PERIOD,
		                       batchUpdateOffset: w * NORMAL_UPDATE_PERIOD});
		simWorker.onmessage = function(event) {
			for (let i = 0; i < event.data.pendingResultsQueue.length; i++) {
				simResults.push(event.data.pendingResultsQueue[i]);
			}
			d3.select('#heatmapSimStatus').text(simResults.length + '/' + simCount + " complete");
			update_heatmap(heatmap_current_methodID);
			if (simResults.length == simCount) {
				endSimulation();
			}
			
		};
	}
}
function simCandidateAnimation() {
	let c = parseInt(document.querySelector('#simCandidateClustering').value);
	if (c > 0) {
		generateNewCandidates("Uniform", true);
		for (let i = 0; i < c; i++) {
			generateNewCandidates("Cluster", i != c-1);
		}
	} else if (c < 0) {
		generateNewCandidates("Uniform", true);
		for (let i = 0; i > c; i--) {
			generateNewCandidates("Party-Cluster", i != c+1);
		}
	} else {
		generateNewCandidates("Uniform");
	}
}

function disableAllControls()
{	
	d3.selectAll(".sim-controls").attr("disabled", true);
	d3.selectAll(".toolbar-button").attr("disabled", true);
}
function startSimWorkersButton() {
	disableAllControls();
	document.querySelector('#startSimButton').disabled = false;
	document.querySelector('#startSimButton').innerHTML = "End Simulation";	
	endHeatmap();
	
	let dispos = document.querySelector('#simDispositionSpread').value.split('_');
	startSimWorkers(parseInt(document.querySelector('#simCount').value),
	                document.querySelector('#simVoterDistribution').value,
	                parseInt(document.querySelector('#simVoterCount').value),
	                parseInt(document.querySelector('#simCandidateCount').value),
	                parseInt(document.querySelector('#simCandidateClustering').value),
	                parseInt(dispos[0]), parseInt(dispos[1]));
	generateNewElectorate(document.querySelector('#simVoterDistribution').value);
	while (parseInt(document.querySelector('#simCandidateCount').value) > candidateCount) {
		generateNewCandidates("Add", true);
	}
	while (parseInt(document.querySelector('#simCandidateCount').value) < candidateCount) {
		generateNewCandidates("Remove", true);
	}
	simCandidateAnimation();
}
let heatmapCandidateCount = 0;
let heatmapNewCandidateDispo = -1;
let heatmapNaturalWinners = new Array(methodList.length);
window.getHeatmapNaturalWinners = function () { return heatmapNaturalWinners; }
let isHeatmapAnyCycles = false;
let isHeatmapAnySpoilers = false;
function startSimSpoilerMapButton() {
	if (isHeatmapActive && !isSimRunning) { returnToDefaultMode(); return; }
	returnToDefaultView();
	disableAllControls();
	d3.selectAll(".sim-controls").attr("disabled", true);
	d3.selectAll(".toolbar-button").attr("disabled", true);
	document.querySelector('#startSpoilerMapButton').disabled = false;
	document.querySelector('#startSpoilerMapButton').innerHTML = "End Simulation";
	isHeatmapActive = true;
	updateHexbinQuick(); //grey out bins
	updateCardinalTable(false); //lock dispo controls
	heatmapCandidateCount = candidateCount;
	heatmapNewCandidateDispo = parseInt(document.querySelector('#heatmapDisposition').value);
	for (let i = 0; i < methodList.length; i++) {
		heatmapNaturalWinners[i] = MRDs[i].naturalWinner;
	}
	startSimWorkersHeatmap(parseInt(document.querySelector('#heatmapSimCount').value), heatmapNewCandidateDispo);
}
function endSimulation() {
	isSimRunning = false;
	for (let sw = simWorkers.length - 1; sw > -1; sw--) {
		simWorkers[sw].terminate();
	}
	simWorkers = [];
	d3.selectAll(".sim-controls").attr("disabled", null);
	document.querySelector('#startSimButton').innerHTML = "Run Batch Simulations";
	if (isHeatmapActive) {		
		document.querySelector('#startSpoilerMapButton').innerHTML = "End Heatmap Analysis";
		if (candidateCount == heatmapCandidateCount) {
			d3.select("#canAddButton").attr("disabled", null);
		} else if (candidateCount > heatmapCandidateCount) {
			d3.select("#canRemoveButton").attr("disabled", null);
		}
	} else {
		document.querySelector('#startSpoilerMapButton').innerHTML = "Run Spoiler Heatmap Analysis";
		d3.selectAll(".toolbar-button").attr("disabled", null);
	}
}
document.querySelector("#startSimButton").addEventListener("click", startSimWorkersButton);
document.querySelector("#startSpoilerMapButton").addEventListener("click", startSimSpoilerMapButton);

function endHeatmap()
{
	isHeatmapActive = false;
	chartHeatmapNode.style("opacity", 0);
	contour_legend.style("opacity", 0);
	updateHexbinQuick();
}
function returnToDefaultMode()
{
	endHeatmap();
	endSimulation();
	returnToDefaultView();
	d3.select("#return_button").style("display", "none");
}
function returnToDefaultView()
{	
	updateCardinalTable();
	displayMode = "default";
	initializeMethodTableTHead();
	initializeMethodTableBody();
	for (let m = 0; m < methodList.length; m++) {
		MRDs[m] = MRDs[m];
		updateMethodTable(m);
	}
	d3.select('#correlation_table').style("display", "none");
}

window.startSimWorkers = startSimWorkers;
window.simWorkers = function() { return simWorkers; };
window.simResults = function() { return simResults; };

function requestStratCARS(key) {
	worker.postMessage({SCARS_key: key});
}function requestSmithCARS(key) {
	worker.postMessage({SmithCARS_key: 1});
}function requestRunnerUpCARS(key) {
	worker.postMessage({RUCARS_key: key});
}
window.requestStratCARS = requestStratCARS;
window.requestSmithCARS = requestSmithCARS;
window.requestRunnerUpCARS = requestRunnerUpCARS;


let currentHeatmapResolution = 100;
let heatmapMarginX = 1.0;
let heatmapMarginY = 1.0;
let contour_values_condorcet = new Array(currentHeatmapResolution * currentHeatmapResolution);
let contour_values_winner = new Array(currentHeatmapResolution * currentHeatmapResolution);

let contours_condorcet = d3.contours()
		.size([currentHeatmapResolution, currentHeatmapResolution])
		.thresholds([0,1,2])
		(contour_values_condorcet);
let contours_winner = d3.contours()
		.size([currentHeatmapResolution, currentHeatmapResolution])
		.thresholds([0,1,2])
		(contour_values_winner);

let contour_colors_condorcet = ["#0000ff", "#8800cc", "#cc0000"];
let contour_colors_winner    = ["#006699", "#ffcccc", "#ffffff"];
let contour_legend_text = ["Loser",
						   "Tiebreaker Loser",
						   "Spoiled by others",
						   "Spoiler",
						   "Tiebreaker \"Spoiler\"",
						   "Mutual Spoiler",
						   "Winner via Spoiler",
						   "Tiebreaker Winner",
						   "Winner"]
let contour_marginX;
let contour_marginY;
let contour_scaleX;
let contour_scaleY;
updateContourParams();

function updateContourParams()
{
	contour_marginX = heatmapMarginX *  width/10;
	contour_marginY = heatmapMarginY * height/10;
	contour_scaleX =  width * (1 - 2*heatmapMarginX/10) / currentHeatmapResolution;
	contour_scaleY = height * (1 - 2*heatmapMarginY/10) / currentHeatmapResolution;
}

chartHeatmapNode
	.style("isolation", "isolate")
	.attr("opacity", "0");
let contour_chart_condorcet = chartHeatmapNode
	.append("g")
      .attr("fill", "none")
      .attr("stroke", "#888")
      .attr("stroke-opacity", "0")
      .style("pointer-events", "none")
	  .selectAll("path")
      .data(contours_condorcet)
      .join("path");
let contour_chart_winner = chartHeatmapNode.append("g")
    .style('mix-blend-mode', 'difference')
    .append("g")
      .attr("fill", "none")
      .attr("stroke", "#888")
      .attr("stroke-opacity", "0")
      .style("pointer-events", "none")
	  .selectAll("path")
      .data(contours_winner)
      .join("path");

let heatmap_legend_current_values = [];
let heatmap_current_methodID = methodList.indexOf("Plurality");
function simResults_to_contourValues(methodID)
{
	heatmap_current_methodID = methodID;
	document.querySelector('#contour_legend_methodName').innerHTML = methodList[methodID];
	isHeatmapAnyCycles = false;
	heatmap_legend_current_values = [];
	contour_values_condorcet = new Array(currentHeatmapResolution * currentHeatmapResolution).fill(0);
	contour_values_winner = new Array(currentHeatmapResolution * currentHeatmapResolution).fill(0);
	let newC = heatmapCandidateCount;
	let myData = simResults;
	for (let i = 0; i < myData.length; i++) {
		let trial = myData[i];
		let q = trial.MRDs[methodID];
		contour_values_winner[trial.heatmapIndex] = q.naturalWinner == newC ? 2 : q.naturalWinner != heatmapNaturalWinners[methodID] ? 1 : 0;
		contour_values_condorcet[trial.heatmapIndex] = trial.conWin == newC ? 2 : trial.smithSet.includes(newC) ? 1 : 0;
		let x = contour_values_winner[trial.heatmapIndex] * 3 + contour_values_condorcet[trial.heatmapIndex];
		if (!heatmap_legend_current_values.includes(x)) {
			heatmap_legend_current_values.push(x);
		}
		if (contour_values_condorcet[trial.heatmapIndex] == 1) { isHeatmapAnyCycles = true; }
		if (contour_values_winner[trial.heatmapIndex] == 1) { isHeatmapAnySpoilers = true; }
	}
}

function update_heatmap_legend()
{
	let target_index = -1;
	if (candidateCount > heatmapCandidateCount) {
		let newC = heatmapCandidateCount;
		let naturalWinner = MRDs[heatmap_current_methodID].naturalWinner;
		let w = naturalWinner == newC ? 2 : naturalWinner != heatmapNaturalWinners[heatmap_current_methodID] ? 1 : 0;
		let c = baseCARS.condorcetWinner == newC ? 2 : baseCARS.smithSet.includes(newC) ? 1 : 0;
		target_index = w*3 + c;
	}
	
	contour_legend.selectAll("svg").remove();
	contour_legend
		.raise()
		.style("left", xScale(4.74) + "px")
		.style("top", yScale(2.5) + "px")
		.transition()
		.duration('50')
		.style("opacity", 1);
	for (let i = 8; i > -1; i--) {
		if (heatmap_legend_current_values.includes(i) || i == target_index) {
			let container = contour_legend.append("svg")
				.style("isolation", "isolate")
				.attr("width", "160px")
				.attr("height","30px");
			container.append("circle")
				.attr("fill", contour_colors_condorcet[i % 3])
				.attr("r", 10)
				.attr("cx", 10)
				.attr("cy", 10);
			container.append("g")
				.style('mix-blend-mode', 'difference')
				.attr("position", "absolute")
				.append("circle")
				.attr("fill", contour_colors_winner[Math.floor(i / 3)])
				.attr("r", 10)
				.attr("cx", 10)
				.attr("cy", 10);
			container.append("text")
				.text(contour_legend_text[i])
				.style("font-weight", target_index == i ? "bold" : "normal")
				.attr("class", "contour-legend-entry")
				.attr("x", 22)
				.attr("y", 16);
		}
	}
}

function update_heatmap(methodID)
{
	simResults_to_contourValues(methodID);
	update_heatmap_legend();
	contours_condorcet = d3.contours()
		.size([currentHeatmapResolution, currentHeatmapResolution])
		.thresholds(isHeatmapAnyCycles ? [0,1,2] : [0,2])
		(contour_values_condorcet);
	contour_chart_condorcet.data(contours_condorcet, e => e.value)
	  .attr("transform", "translate(" + contour_marginX +  "," + contour_marginY + "), scale(" + contour_scaleX + "," + contour_scaleY + ")")
	  .join("path")
        .attr("fill", d => contour_colors_condorcet[d.value])
        .attr("d", d3.geoPath());
	
	chartHeatmapNode.style("opacity", 0.85);
	contours_winner = d3.contours()
		.size([currentHeatmapResolution, currentHeatmapResolution])
		.thresholds(isHeatmapAnySpoilers ? [0,1,2] : [0,2])
		(contour_values_winner);
	contour_chart_winner.data(contours_winner, e => e.value)
	  .attr("transform", "translate(" + contour_marginX +  "," + contour_marginY + "), scale(" + contour_scaleX + "," + contour_scaleY + ")")
	  .join("path")
        .attr("fill", d => contour_colors_winner[d.value])
        .attr("d", d3.geoPath());
}