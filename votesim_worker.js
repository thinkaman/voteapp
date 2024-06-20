/*jshint esversion: 11 */

import { PERFECTION_PENALTY } from './votesim_common.js';

import {reseed} from './votesim_common.js';

import {methodList} from './votesim_common.js';
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

let voter_data;
let candidate_data;

let baseCARS;
let smithCARS;
let landauCARS;
let strategicCARSs;
let runnerUpCARSs;
let leftCARS;
let rightCARS;
let ltLeftCARS;
let ltRightCARS;
let MRDs = {};

let isCurrentlyRecordingElimData;
let currentElimRecordData;
let currentElimUMFData;
let currentElimDMFData;
function initElimRecordData() {
	currentElimRecordData = [];
	currentElimUMFData = {};
	currentElimDMFData = {};
}

onmessage = function handleMessageFromMain(msg) {
	if ("heatmapIndexOffset" in msg.data) { //this is a heatmap batch request
		runHeatmapTrials(msg.data.simCount, msg.data.heatmapIndexOffset,
		                 msg.data.heatmapResolution, msg.data.heatmapMarginX, msg.data.heatmapMarginY,
                         msg.data.voter_data, msg.data.candidate_data, msg.data.newDispo,
	                     msg.data.batchUpdatePeriod, msg.data.batchUpdateOffset);
		return;
	}	
	if ("simCount" in msg.data) { //this is a randomized simulation batch request
		runTrials(msg.data.simCount, msg.data.voterCategory, msg.data.voterCount,
		          msg.data.candidateCount, msg.data.numberOfClusterIterations,
		          msg.data.lowerDispoBound, msg.data.upperDispoBound,
		          msg.data.batchUpdatePeriod, msg.data.batchUpdateOffset);
		return;
	}
	if ("SCARS_key" in msg.data) {
		self.postMessage({kind: "stratCARS", data: strategicCARSs[msg.data.SCARS_key]});
		return;
	}
	if ("RUCARS_key" in msg.data) {
		self.postMessage({kind: "runnerUpCARS", data: runnerUpCARSs[parseInt(msg.data.RUCARS_key)]});
		return;
	}
	if ("SmithCARS_key" in msg.data) {
		self.postMessage({kind: "smithCARS", data: smithCARS});
		return;
	}
	let isCardinalOnly = msg.data.isCardinalOnly;
	let cacheKey = msg.data.cacheKey;
	voter_data = msg.data.voter_data;
	candidate_data = msg.data.candidate_data;
	
	createBaseCARS();
	self.postMessage({kind: "baseCARS-creation", data: baseCARS, isCardinalOnly: isCardinalOnly});
	analyzeBaseCARS();
	self.postMessage({kind: "baseCARS-analysis", data: baseCARS, isCardinalOnly: isCardinalOnly});	
	createPartisanCARS();
	//self.postMessage({kind: "leftCARS-analysis", data: leftCARS, isCardinalOnly: isCardinalOnly});
	//self.postMessage({kind: "rightCARS-analysis", data: rightCARS, isCardinalOnly: isCardinalOnly});
	computeAllMRDs(isCardinalOnly, cacheKey);
	return;
};

const MAX_RANGE_DISTANCE = 5; //only relevant to raw range

function isCooperating(i, attacker, target) {
	if (target == null) {return false;}
	if (attacker == -1) {return voter_data[i][3][0] != target;}
	return voter_data[i][2][attacker] <= voter_data[i][2][target];
}

class CARS { //candidate analysis results set
	
	cs;
	attacker;
	target;
	counterStrategy;
	
	dispo_normalized_voter_data;
	
	results;
	resultsPercentile;
	wins; //count
	sortedWins; //indexes
	lossLists;
	smithSet;
	condorcetWinner;
	condorcetLoser;
	firstRankVotes;
	lastRankVotes;
	bordaScores;
	dowdallScores;
	medianScores;
	sortedFirstRankVotes; //indexes
	sortedLastRankVotes; //indexes
	sortedBordaScores; //indexes
	sortedDowdallScores; //indexes
	sortedMedianScores; //indexes
	totalLinearDistance;
	totalNormalizedDistance;
	totalApprovalScores;
	sortedTotalLinearDistance; //indexes
	sortedTotalNormalizedDistance; //indexes
	sortedTotalApprovalScores; //indexes

	constructor(cs = null, calcUtilityWinners = true, eliminationAlterationOf = null, autoAnalyze = null,
	            attacker = null, target = null, counterStrategy = false, partisanMask = 0, lowTurnout = false, top2only = false) {
		if (cs == null) { cs = [...Array(candidate_data.length).keys()]; }
		for (let i = cs.length - 1; i > -1; i--)
		{
			if (candidate_data[cs[i]][5]) { cs.splice(i,1); } //omit hidden candidates
		}
		this.cs = cs;
		this.partisanMask = partisanMask;
		this.lowTurnout = lowTurnout;
		
		//cache attempt
		if (eliminationAlterationOf != null)
		{
			this.results = eliminationAlterationOf.results;
			this.resultsPercentile = eliminationAlterationOf.resultsPercentile;
			
			if (autoAnalyze == "ordinal") {
				this.dispo_normalized_voter_data = eliminationAlterationOf.dispo_normalized_voter_data;
			} else {
				this.normalizeVoterData(calcUtilityWinners);
			}
		}
		else {
			this.normalizeVoterData(calcUtilityWinners);
			
			let isAttackerRight = false;
			if (attacker != null && attacker >= 0 && candidate_data[attacker][0] > 0) isAttackerRight = true;
			let isAttackerLeft = false;
			if (attacker != null && attacker >= 0 && candidate_data[attacker][0] <= 0) isAttackerLeft = true;
			if (isAttackerRight && partisanMask < 0) { partisanMask = 0; }
			if (isAttackerLeft  && partisanMask > 0) { partisanMask = 0; }
			
			//NOTE: results grid is ALWAYS full-sized, with empty spaces for candidates outside the current set (and A vs A)
			this.results = new Array(candidate_data.length);
			this.resultsPercentile = new Array(candidate_data.length);
			for (let c1 = 0; c1 < cs.length; c1++) {
				let myResults = new Array(candidate_data.length);
				let can1 = cs[c1];
				for (let c2 = 0; c2 < cs.length; c2++) {
					if (c1 == c2) continue;
					let can2 = cs[c2];
					let count = 0;
					for (let i = 0; i < voter_data.length; i++) {
						if (lowTurnout       && voter_data[i][5] == 0) { continue; }
						if (partisanMask < 0 && voter_data[i][0] >  0) { continue; }
						if (partisanMask > 0 && voter_data[i][0] <= 0) { continue; }
						let cooperating = isCooperating(i, attacker, target);
						let anticooperating = counterStrategy && !cooperating;
						if      (cooperating && can1 == attacker) { count++; }
						else if (cooperating && can1 == target)   { }
						else if (cooperating && can2 == attacker) { }
						else if (cooperating && can2 == target)   { count++; }
						else if (anticooperating && can1 == attacker) { }
						else if (anticooperating && can1 == target)   { count++; }
						else if (anticooperating && can2 == attacker) { count++; }
						else if (anticooperating && can2 == target)   { }
						else {
							if (voter_data[i][2][can1] <= voter_data[i][2][can2]) { count++; }
						}
					}
					myResults[can2] = count;
				}
				this.results[can1] = myResults;
			}
			for (let c1 = 0; c1 < candidate_data.length; c1++) {
				let myPercentileResults = new Array(candidate_data.length);
				for (let c2 = 0; c2 < candidate_data.length; c2++) {
					if (c1 == c2 || this.results[c1] == null || this.results[c2] == null) {continue;}
					myPercentileResults[c2] = this.results[c1][c2] / (this.results[c1][c2] + this.results[c2][c1]);
				}
				this.resultsPercentile[c1] = myPercentileResults;
			}
		}
		
		this.wins = new Array(candidate_data.length).fill(0);
		for (let c1 = 0; c1 < cs.length; c1++) {
			let can1 = cs[c1];
			for (let c2 = 0; c2 < cs.length; c2++) {
				if (c1 == c2) continue;
				let can2 = cs[c2];
				if (this.results[can1][can2] > this.results[can2][can1] ||
				   (this.results[can1][can2] == this.results[can2][can1] && can1 < can2)) { this.wins[can1]++; }
			}
		}
		this.lossLists = new Array(candidate_data.length);
		for (let c1 = 0; c1 < cs.length; c1++) {
			let can1 = cs[c1];
			let losses = [];
			for (let c2 = 0; c2 < cs.length; c2++) {
				let can2 = cs[c2];
				if (this.results[can1][can2] < this.results[can2][can1] ||
					(this.results[can1][can2] == this.results[can2][can1] && can1 > can2)) { losses.push(can2); }
			}
			this.lossLists[can1] = losses;
		}
		this.sortedWins = Array.from(Array(this.wins.length).keys())
			.sort((a, b) => this.wins[a] == null ? 1 : this.wins[b] == null ? -1 : this.wins[b] - this.wins[a]);
	
		let toBeAdded = [this.sortedWins[0]];
		this.smithSet = [];
		if (cs.length == 1) { this.smithSet.push(cs[0]); }
		else {
			while (toBeAdded.length > 0) {
				let losses = this.lossLists[toBeAdded[0]];
				if (losses == null) {console.log(this);}
				for (let i = 0; i < losses.length; i++) {
					let can1 = losses[i];
					if (!(this.smithSet.includes(can1)) && !(toBeAdded.includes(can1))) { toBeAdded.push(can1); }
				}
				this.smithSet.push(toBeAdded.shift());
			}
		}
		if (this.smithSet.length == 1) {
			this.condorcetWinner = this.smithSet[0];
			this.landauSet = this.smithSet;
		} else if (this.smithSet.length < 4) {
			this.condorcetWinner = null;
			this.landauSet = this.smithSet;
		} else {
			this.condorcetWinner = null;
			this.landauSet = [];
			for (let c1 = 0; c1 < this.smithSet.length; c1++) {
				let can1 = this.cs[c1];
				let isDominated = false;
				// for any c1, is there a superior c2 that beats every other c3 harder, including beating c1 himself? 
				for (let c2 = 0; c2 < this.smithSet.length; c2++) {
					if (c1 == c2) {continue;}
					let can2 = this.cs[c2];
					let isPossiblyDominating = true;
					if (this.results[can1][can2] > this.results[can2][can1]) {
						//win directly, nevermind
						isPossiblyDominating = false;
					} else {
						for (let c3 = 0; c3 < this.smithSet.length; c3++) {
							if (c1 == c3 || c2 == c3) {continue;}
							let can3 = this.cs[c3];
							if (this.results[can1][can3] > this.results[can2][can3]) {
								//we found a case where this isn't true, so nevermind for this pair
								isPossiblyDominating = false;
								break;
							}
						}
					}
					if (isPossiblyDominating) {
						isDominated = true;
						break;
					}
				}
				if (!isDominated) {
					this.landauSet.push(can1);
				}
			}
		}
		this.condorcetLoser = null;
		for (let c1 = 0; c1 < candidate_data.length; c1++) {
			if (this.lossLists[c1] != null && this.lossLists[c1].length == this.cs.length - 1) { this.condorcetLoser = c1; break; }
		}
		
		if (autoAnalyze == "all") {
			this.analyzeOrdinal(attacker, target, counterStrategy, partisanMask, lowTurnout, top2only);
			this.analyzeCardinal(attacker, target, counterStrategy, partisanMask, lowTurnout, top2only);
			this.analyzeMedian(attacker, target, counterStrategy, partisanMask, lowTurnout, top2only);
			this.dispo_normalized_voter_data = null; //we don't need this anymore
		} else if (autoAnalyze == "ordinal") {
			this.analyzeOrdinal(attacker, target, counterStrategy, partisanMask, lowTurnout, top2only);
		} else if (autoAnalyze == "cardinal") {
			this.analyzeCardinal(attacker, target, counterStrategy, partisanMask, lowTurnout, top2only);
		} else if (autoAnalyze == "median") {
			this.analyzeMedian(attacker, target, counterStrategy, partisanMask, lowTurnout, top2only);
		}
		return this;
	}

	analyzeOrdinal(attacker = null, target = null, counterStrategy = false, partisanMask = 0, lowTurnout = false, top2only = false) {
		let cs = this.cs;
		this.attacker = attacker;
		this.target = target;
		this.counterStrategy = counterStrategy;
		
		this.firstRankVotes = new Array(candidate_data.length).fill(null);
		this.lastRankVotes = new Array(candidate_data.length).fill(null);
		this.bordaScores = new Array(candidate_data.length).fill(null);
		this.dowdallScores = new Array(candidate_data.length).fill(null);
		for (let c1 = 0; c1 < cs.length; c1++) {
			let can1 = cs[c1];
			let count1 = 0;
			let count2 = 0;
			let count3 = 0;
			let count4 = 0;
			for (let i = 0; i < voter_data.length; i++) {
				if (lowTurnout       && voter_data[i][5] == 0) { continue; }
				if (partisanMask < 0 && voter_data[i][0] >  0) { continue; }
				if (partisanMask > 0 && voter_data[i][0] <= 0) { continue; }
				let borda = cs.length - 1;
				let bordaSkip = null;
				let cooperating = isCooperating(i, attacker, target);
				let anticooperating = counterStrategy && !cooperating;
				if (cooperating && attacker != -1) { //normal strategy -- rally around the attacker, bury the target (last place)
					if      (can1 == attacker) { count1++; count3 += borda; count4++; continue; }
					else if (can1 == target)   { count2++; continue; }
					borda--;
					bordaSkip = attacker;
				} else if (anticooperating) {
					if      (can1 == target)   { count1++; count3 += borda; count4++; continue; }
					else if (can1 == attacker) { count2++; continue; }
					borda--;
					bordaSkip = target;
				} else if (cooperating && attacker == -1) { //mass-burial gang-up; not currently used
					if (can1 == target) { count2++; continue; }
					for (let c2 = 0; c2 < candidate_data.length; c2++) {
						let can2 = voter_data[i][3][c2];
						if (can1 == can2) { count1++; break; }
						if (cs.includes(can2)) { break; }
					}
				} else {
					for (let c2 = 0; c2 < candidate_data.length; c2++) {
						let can2 = voter_data[i][3][c2];
						if (top2only && c2 == 2) { break; }
						if (can1 == can2) { count1++; break; }
						if (cs.includes(can2)) { break; }
					}
					for (let c2 = candidate_data.length - 1; c2 > -1; c2--) {
						let can2 = voter_data[i][3][c2];
						if (can1 == can2) { count2++; break; }
						if (cs.includes(can2)) { break; }
					}
				}
				if ((!cooperating && !anticooperating) || (can1 != attacker && can1 != target)) {
					for (let c2 = 0; c2 < candidate_data.length; c2++) {
						let can2 = voter_data[i][3][c2];
						if (can1 == can2) { break; }
						if (!cs.includes(can2)) { continue; }
						if (can2 != bordaSkip) { borda--; } //did we already subtract the borda point from the strategized attacker?
					}
					count3 += borda;
					count4 += borda == 0 ? 0 : 1/(cs.length - borda);
				}
			}
			this.firstRankVotes[can1] = count1;
			this.lastRankVotes[can1] = count2;
			this.bordaScores[can1] = count3;
			this.dowdallScores[can1] = count4;
		}
		this.sortedWins = Array.from(Array(this.wins.length).keys())
			.sort((a, b) => this.wins[a] == null ? 1 : this.wins[b] == null ? -1 :
			                this.wins[a] == this.wins[b] ? this.firstRankVotes[b] - this.firstRankVotes[a] :
			                this.wins[b] - this.wins[a]);
		this.sortedFirstRankVotes = Array.from(Array(this.firstRankVotes.length).keys())
			.sort((a, b) => this.firstRankVotes[a] == null ? 1 : this.firstRankVotes[b] == null ? -1 :
			                this.firstRankVotes[b] - this.firstRankVotes[a]);
		this.sortedLastRankVotes = Array.from(Array(this.lastRankVotes.length).keys())
			.sort((a, b) => this.lastRankVotes[a] == null ? 1 :
			                this.lastRankVotes[b] == null ? -1 :
			                this.lastRankVotes[a] != this.lastRankVotes[b] ? this.lastRankVotes[a] - this.lastRankVotes[b] :
			                this.firstRankVotes[a] - this.firstRankVotes[b]);
		this.sortedBordaScores = Array.from(Array(this.bordaScores.length).keys())
			.sort((a, b) => this.bordaScores[a] == null ? 1 : this.bordaScores[b] == null ? -1 :
			                this.bordaScores[b] - this.bordaScores[a]);
		this.sortedDowdallScores = Array.from(Array(this.dowdallScores.length).keys())
			.sort((a, b) => this.dowdallScores[a] == null ? 1 : this.dowdallScores[b] == null ? -1 :
			                this.dowdallScores[b] - this.dowdallScores[a]);
		
		return this;
	}
	
	analyzeCardinal(attacker = null, target = null, counterStrategy = false, partisanMask = 0, lowTurnout = false, top2only = false) {
		let cs = this.cs;
		this.attacker = attacker;
		this.target = target;
		this.counterStrategy = counterStrategy;
		
		this.totalLinearDistance = new Array(candidate_data.length).fill(null);
		this.totalNormalizedDistance = new Array(candidate_data.length).fill(null);
		this.totalApprovalScores = new Array(candidate_data.length).fill(null);
		for (let c1 = 0; c1 < cs.length; c1++) {
			let can1 = cs[c1];
			let count2 = 0;
			let count3 = 0;
			let count4 = 0;
			for (let i = 0; i < voter_data.length; i++) {
				if (lowTurnout       && voter_data[i][5] == 0) { continue; }
				if (partisanMask < 0 && voter_data[i][0] >  0) { continue; }
				if (partisanMask > 0 && voter_data[i][0] <= 0) { continue; }
				let cooperating = isCooperating(i, attacker, target);
				let anticooperating = counterStrategy && !cooperating;
				
				if      (cooperating && can1 == attacker)     {count2 +=  0; count3 += 0; count4 += 0;}
				else if (cooperating && can1 == target)       {count2 += MAX_RANGE_DISTANCE; count3 += 1; count4 += 1;}
				else if (anticooperating && can1 == target)   {count2 +=  0; count3 += 0; count4 += 0; }
				else if (anticooperating && can1 != target)   {count2 += MAX_RANGE_DISTANCE; count3 += 1; count4 += 1;}
				else {
					count2 += Math.min(MAX_RANGE_DISTANCE, voter_data[i][2][can1]);
					let score = this.dispo_normalized_voter_data[i][can1];
					count3 += score;
					count4 += score > 0.5 ? 1 : 0;
				}
			}
			this.totalLinearDistance[can1] = count2;
			this.totalNormalizedDistance[can1] = count3;
			this.totalApprovalScores[can1] = count4;
		}
		
		//lower is better/first
		this.sortedTotalLinearDistance = Array.from(Array(this.totalLinearDistance.length).keys())
			.sort((a, b) => this.totalLinearDistance[a] == null ? 1 : this.totalLinearDistance[b] == null ? -1 :
							this.totalLinearDistance[a] - this.totalLinearDistance[b]);
		this.sortedTotalNormalizedDistance = Array.from(Array(this.totalNormalizedDistance.length).keys())
			.sort((a, b) => this.totalNormalizedDistance[a] == null ? 1 : this.totalNormalizedDistance[b] == null ? -1 :
							this.totalNormalizedDistance[a] - this.totalNormalizedDistance[b]);
		this.sortedTotalApprovalScores = Array.from(Array(this.totalApprovalScores.length).keys())
			.sort((a, b) => this.totalApprovalScores[a] == null ? 1 : this.totalApprovalScores[b] == null ? -1 :
							this.totalApprovalScores[a] - this.totalApprovalScores[b]);
	}
	
	analyzeMedian(attacker = null, target = null, counterStrategy = false, partisanMask = 0, lowTurnout = false, top2only = false) {
		let cs = this.cs;
		this.attacker = attacker;
		this.target = target;
		this.counterStrategy = counterStrategy;
		
		this.medianScores = new Array(candidate_data.length).fill(null);
		for (let c1 = 0; c1 < cs.length; c1++) {
			let can1 = cs[c1];
			let scores = new Array(voter_data.length);
			for (let i = 0; i < voter_data.length; i++) {
				if (lowTurnout       && voter_data[i][5] == 0) { continue; }
				if (partisanMask < 0 && voter_data[i][0] >  0) { continue; }
				if (partisanMask > 0 && voter_data[i][0] <= 0) { continue; }
				let cooperating = isCooperating(i, attacker, target);
				let anticooperating = counterStrategy && !cooperating;
				
				if      (cooperating && can1 == attacker)     {scores[i] = 0;}
				else if (cooperating && can1 == target)       {scores[i] = 1;}
				else if (anticooperating && can1 == target)   {scores[i] = 0;}
				else if (anticooperating && can1 != target)   {scores[i] = 1;}
				else {
					scores[i] = this.dispo_normalized_voter_data[i][can1];
				}
			}
			scores.sort();
			this.medianScores[can1] = scores[Math.floor(scores.length/2)];
		}
		this.sortedMedianScores = Array.from(Array(this.medianScores.length).keys())
			.sort((a, b) => this.medianScores[a] == null ? 1 : this.medianScores[b] == null ? -1 :
							this.medianScores[a] - this.medianScores[b]);
	}
	
	normalizeVoterData(calcUtilityWinners) {
		this.dispo_normalized_voter_data = new Array(voter_data.length);
		let dispos = new Array(voter_data.length);
		for (let i = 0; i < voter_data.length; i++) {
			let favorite = -1;
			let myMin = 9999999;
			let myMax = 0;
			for (let c1 = 0; c1 < this.cs.length; c1++) {
				let can1 = this.cs[c1];
				if (voter_data[i][2][can1] < myMin) {myMin = voter_data[i][2][can1]; favorite = can1;}
				myMax = Math.max(myMax, voter_data[i][2][can1]);
			}
			dispos[i] = candidate_data[favorite][4];
			this.dispo_normalized_voter_data[i] = voter_data[i][2].map(x => {
				if (x <= myMin) {return 0;}
				if (x >= myMax) {return 1;}
				return (x - myMin) / (myMax - myMin) *
				       (1 - PERFECTION_PENALTY) + PERFECTION_PENALTY;
				});
				//note we haven't applied dispositions yet!
		}
		//if we are going to calculate overall utility winners, do it with the raw data
		if (calcUtilityWinners) {
			this.addUtilityWinners();
		}
		//*now* apply dispositions
		for (let i = 0; i < voter_data.length; i++) {
			this.dispo_normalized_voter_data[i] = this.dispo_normalized_voter_data[i].map(x => applyDispo(x,dispos[i]));
		}
	}

	addUtilityWinners() {
		this.utilityWinners = new Array(11);
		for (let dispo = 0; dispo <= 10; dispo++) {
			let totals = new Array(candidate_data.length).fill(null);
			for (let c1 = 0; c1 < this.cs.length; c1++) {
				let can1 = this.cs[c1];
				let count = 0;
				for (let i = 0; i < voter_data.length; i++) {
					//at this point the distances are still raw, so we can apply our reference dispos to them
					count += applyDispo(this.dispo_normalized_voter_data[i][can1],dispo);
				}
				totals[can1] = count;
			}
			let lowest = 99999999;
			let winner = -1;
			
			for (let c1 = 0; c1 < candidate_data.length; c1++) {
				if (totals[c1] != null && totals[c1] < lowest) { lowest = totals[c1]; winner = c1; }
			}
			this.utilityWinners[dispo] = winner;
		}
	}
}

function Top2RunoffMonoticityTest(myCARS, can1, can2, can3) { //T2R only needs a test for monotonicity testing; results are easy

	//find UMB data -- does the 2nd place eliminating the 3rd "protect" a weaker survivor
	//		from a candidate who could beat them? (We don't care about others)
	//"If x-y voters change their vote to winner A from 2nd-place B, it actually makes 3rd-place C replace A as winner."
	//		elimUMFData[A][B][C] = [x,y]
	let marginOfUltimateVictory = myCARS.results[can3][can1] - myCARS.results[can1][can3]; //how much C ultimately beats A, given the chance to face off
	if (marginOfUltimateVictory > 0) {
		let marginOfElimination = myCARS.firstRankVotes[can2] - myCARS.firstRankVotes[can3]; //how much A is beating C
	
		let nonCostlyChanges = 0; //how many votes can change to A from B without cutting into C's margin over A; (B>A>C)
		for (let i = 0; i < voter_data.length; i++) {
			let voter = voter_data[i];
			if (voter[2][can2] < voter[2][can1] && voter[2][can1] < voter[2][can3]) {nonCostlyChanges++;}
		}
		
		let budget = nonCostlyChanges + marginOfUltimateVictory/2;
		if (marginOfElimination < budget) { //is this change possible in our "budget"?
			if (!(can1 in currentElimUMFData)) {currentElimUMFData[can1] = {};}
			if (!(can2 in currentElimUMFData[can1])) {currentElimUMFData[can1][can2] = {};}
			currentElimUMFData[can1][can2][can3] = [marginOfElimination, budget];
		}
	}
	
	marginOfUltimateVictory = myCARS.results[can3][can2] - myCARS.results[can2][can3]; //how much C ultimately beats A, given the chance to face off
	if (marginOfUltimateVictory > 0) {
		let marginOfElimination = myCARS.firstRankVotes[can1] - myCARS.firstRankVotes[can3]; //how much A is beating C
	
		let nonCostlyChanges = 0; //how many votes can change to A from B without cutting into C's margin over A; (B>A>C)
		for (let i = 0; i < voter_data.length; i++) {
			let voter = voter_data[i];
			if (voter[2][can1] < voter[2][can2] && voter[2][can2] < voter[2][can3]) {nonCostlyChanges++;}
		}
		
		let budget = nonCostlyChanges + marginOfUltimateVictory/2;
		if (marginOfElimination < budget) { //is this change possible in our "budget"?
			if (!(can2 in currentElimUMFData)) {currentElimUMFData[can2] = {};}
			if (!(can1 in currentElimUMFData[can2])) {currentElimUMFData[can2][can1] = {};}
			currentElimUMFData[can2][can1][can3] = [marginOfElimination, budget];
		}
	}
	
	//find DMB data -- pushover
	//"If x-y voters change their vote to 3rd-place B from 2nd-place C, it actually makes C win by eliminating the normal winner A that would otherwise defeat C."
	//		elimLMFData[A][B][C] = [x,y]		current eliminated loser is B
	let marginOfElimination = myCARS.firstRankVotes[can1] - myCARS.firstRankVotes[can3]; //how narrowly did A avoid elimination?
	marginOfUltimateVictory = myCARS.results[can2][can3] - myCARS.results[can3][can2]; //how much C ultimately beats B, given the chance to face off
	
	//note: all votes are "costly" here; every vote that goes from C --> B penalizes C fighting B later	
	let budget = Math.min(myCARS.firstRankVotes[can2] - myCARS.firstRankVotes[can1], //at this point C would be eliminated
	                      marginOfUltimateVictory/2); //at this point C would lose to B
	if (marginOfElimination < budget) //within budget
	{
		if (!(can1 in currentElimDMFData)) {currentElimDMFData[can1] = {};}
		if (!(can3 in currentElimDMFData[can1])) {currentElimDMFData[can1][can3] = {};}
		currentElimDMFData[can1][can3][can2] = [marginOfElimination, budget];
	}
}

function HareTest(myCARS, condorcetCheck = false, smithCheck = false, woodallCheck = false, landauCheck = false, top2only = false) {
	//condorcetCheck == true stops the process when there is a condorcet winner rather than wiat for a majority winner
	//smithCheck == true tries to re-filter the Smith set after each elimination (Tideman's Alt)
	//woodallCheck == true stops the process if there is only one original Smith set member remaining
	//landauCheck == true tries to re-filter the Smith set after each elimination (Landau Tideman's Alt)
	//top2only == true ignores all ranks past #2
	let testCARS = myCARS;
	let prevCARS;
	let round = 0;
	let loser = -1;
	let originalSmithSet = myCARS.smithSet;
	
	while (testCARS.cs.length > 2) {
		for (let i = testCARS.sortedFirstRankVotes.length - 1; i > -1; i--) {
			loser = testCARS.sortedFirstRankVotes[i];
			if (testCARS.cs.includes(loser)) {break;}
		}
		let newCS = testCARS.cs.filter(c => c !== loser);
		prevCARS = testCARS;
		testCARS = new CARS(newCS, false, testCARS, "ordinal", testCARS.attacker, testCARS.target, testCARS.counterStrategy, testCARS.partisanMask, testCARS.lowTurnout, top2only);
		if (isCurrentlyRecordingElimData) {
			for (let c1 = 0; c1 < myCARS.sortedFirstRankVotes.length; c1++) {
				let can1 = myCARS.sortedFirstRankVotes[c1];
				if (!(prevCARS.cs.includes(can1))) {continue;}
				if (can1 == loser) {continue;}
				let oldValue = prevCARS.firstRankVotes[can1];
				if (oldValue != null) {
					currentElimRecordData.push({
						source: "r" + round + "-" + can1,
						target: "r" + (round+1) + "-" + can1,
						value: oldValue
					});
				}
			}
			for (let c1 = 0; c1 < myCARS.sortedFirstRankVotes.length; c1++) {
				let can1 = myCARS.sortedFirstRankVotes[c1];
				if (!(prevCARS.cs.includes(can1))) {continue;}
				if (can1 == loser) {continue;}
				let oldValue = prevCARS.firstRankVotes[can1];
				let newValue = testCARS.firstRankVotes[can1];
				if (oldValue != null) {
					if (newValue == null) {newValue = 0;}
					currentElimRecordData.push({
						source: "r" + round + "-" + loser,
						target: "r" + (round+1) + "-" + can1,
						value: newValue - oldValue
					});
				}
			}
			
			//find UMB data -- which eliminations "protect" a weaker survivor
			//		from a candidate who could eventually beat them?
			//"If x-y voters change their vote to winner A from loser B, it actually makes C replace A as winner."
			//		elimUMFData[A][B][C] = [x,y]		current eliminated loser is C
			for (let c1 = 0; c1 < newCS.length; c1++) {
				let can1 = newCS[c1];
				let marginOfUltimateVictory = prevCARS.results[loser][can1] - prevCARS.results[can1][loser]; //how much C ultimately beats A, given the chance to face off
				if (marginOfUltimateVictory < 0) {continue;}
				for (let c2 = 0; c2 < newCS.length; c2++) {
					if (c1 == c2) {continue;}
					let can2 = newCS[c2];
					
					let marginOfElimination = prevCARS.firstRankVotes[can2] - prevCARS.firstRankVotes[loser]; //how much A is beating C
					
					//how many votes can change to A from B without cutting into C's margin over A? (B>A>C)
					//these voters are uncapped; all of them are free to move without altering the risk C poses to A
					let nonCostlyChanges = 0; 
					for (let i = 0; i < voter_data.length; i++) {
						let voter = voter_data[i];
						if (voter[2][can2] < voter[2][can1] && voter[2][can1] < voter[2][loser]) {nonCostlyChanges++;}
					}
					//other voters (who currently support C over A) would actually make A stronger if they switch
					let costlyChanges = prevCARS.firstRankVotes[can2] - nonCostlyChanges;
					
					//check to see if someone else besides B would eliminate C anyway next round, no matter what
					let isHopeless = false;
					let bestCaseNextRound = costlyChanges + prevCARS.firstRankVotes[loser];
					for (let c3 = 0; c3 < newCS.length; c3++) {
						if (c2 == c3) {continue;}
						let can3 = newCS[c3];
						if (bestCaseNextRound < prevCARS.firstRankVotes[can3])
						{ isHopeless = true; } //this is conservative...
					}
					if (isHopeless) {continue;}
					
					//we have to cap how many can contribute, before A just beats C naturally and makes our investigation moot
					costlyChanges = Math.min(costlyChanges, marginOfUltimateVictory/2);				
					
					let budget = nonCostlyChanges + costlyChanges;
					if (marginOfElimination < budget) { //is this change possible in our "budget"?
						if (!(can1 in currentElimUMFData)) {currentElimUMFData[can1] = {};}
						if (!(can2 in currentElimUMFData[can1])) {currentElimUMFData[can1][can2] = {};}
						currentElimUMFData[can1][can2][loser] = [marginOfElimination, budget];
					}
				}
			}
			
			//find DMB data -- pushover
			//"If x-y voters change their vote to loser B from loser C, it actually makes loser C win by eliminating the normal winner A that would ultimately defeat C."
			//		elimLMFData[A][B][C] = [x,y]		current eliminated loser is B
			for (let c1 = 0; c1 < newCS.length; c1++) {
				let can1 = newCS[c1];
				let marginOfElimination = prevCARS.firstRankVotes[can1] - prevCARS.firstRankVotes[loser]; //how narrowly did A avoid elimination?
				for (let c3 = 0; c3 < newCS.length; c3++) {
					if (c1 == c3) {continue;}
					let can3 = newCS[c3];
					let marginOfUltimateVictory = prevCARS.results[can3][loser] - prevCARS.results[loser][can3]; //how much C ultimately beats B, given the chance to face off
					
					//note: all votes are "costly" here; every vote that goes from C --> B penalizes C fighting B later
					
					let budget = Math.min(prevCARS.firstRankVotes[can3] - prevCARS.firstRankVotes[can1], //elim now
					                      testCARS.firstRankVotes[can3] - Math.min(...testCARS.firstRankVotes), //elim next
					                      marginOfUltimateVictory/2); //at this point C would lose to B
					if (marginOfElimination < budget) //within budget
					{
						if (!(can1 in currentElimDMFData)) {currentElimDMFData[can1] = {};}
						if (!(loser in currentElimDMFData[can1])) {currentElimDMFData[can1][loser] = {};}
						currentElimDMFData[can1][loser][can3] = [marginOfElimination, budget];
					}
				}
			}
		}
		round++;
		
		if (condorcetCheck) {
			if (testCARS.smithSet.length == 1) {return testCARS.smithSet; }
		}		
		if (smithCheck) {
			if (testCARS.smithSet.length < testCARS.cs.length) {
				testCARS = new CARS(testCARS.smithSet, false, testCARS, "ordinal", testCARS.attacker, testCARS.target, testCARS.counterStrategy, testCARS.partisanMask);
			}
		} else if (landauCheck) {
			if (testCARS.landauSet.length < testCARS.cs.length) {
				testCARS = new CARS(testCARS.landauSet, false, testCARS, "ordinal", testCARS.attacker, testCARS.target, testCARS.counterStrategy, testCARS.partisanMask);
			}
		}
		if (woodallCheck) {			
			let s = 0; //let's count how many original smith set members are left
			for (let can1 of testCARS.cs) { if (originalSmithSet.includes(can1)) s++; }
			if (s == 1) { return testCARS.smithSet; } //last remaining one?  we're done
		}
	}
	return testCARS.sortedFirstRankVotes;
}

function IPETest(myCARS) {
	let testCARS = myCARS;
	let prevCARS;
	let round = 0;
	let loser = -1;
	
	while (testCARS.cs.length > 2) {	
		if (testCARS.condorcetLoser != null) { loser = testCARS.condorcetLoser; }
		else {		
			for (let i = testCARS.sortedBordaScores.length - 1; i > -1; i--) {
				loser = testCARS.sortedBordaScores[i];
				if (testCARS.cs.includes(loser)) {break;}
			}
		}
			
		let newCS = testCARS.cs.filter(c => c !== loser);
		prevCARS = testCARS;
		testCARS = new CARS(newCS, false, testCARS, "ordinal", testCARS.attacker, testCARS.target, testCARS.counterStrategy, testCARS.partisanMask);
		
		if (isCurrentlyRecordingElimData) {
			let totalBorda_old = 0;
			let totalBorda_new = 0;
			for (let c1 = 0; c1 < prevCARS.bordaScores.length; c1++) {
				if (prevCARS.bordaScores[c1]) {
					totalBorda_old += prevCARS.bordaScores[c1];
				}
			}
			for (let c1 = 0; c1 < testCARS.bordaScores.length; c1++) {
				if (testCARS.bordaScores[c1]) {
					totalBorda_new += testCARS.bordaScores[c1];
				}
			}
			
			for (let c1 = 0; c1 < prevCARS.sortedBordaScores.length; c1++) {
				let can1 = prevCARS.sortedBordaScores[c1];
				if (can1 == loser) {continue;}
				let oldValue = prevCARS.bordaScores[can1];
				if (oldValue != null) {
					currentElimRecordData.push({
						source: "r" + round + "-" + can1,
						target: "r" + (round+1) + "-" + can1,
						value: oldValue / totalBorda_old
					});
				}
			}
			for (let c1 = 0; c1 < prevCARS.sortedBordaScores.length; c1++) {
				let can1 = prevCARS.sortedBordaScores[c1];
				if (can1 == loser) {continue;}
				let oldValue = prevCARS.bordaScores[can1];
				let newValue = testCARS.bordaScores[can1];
				if (oldValue != null) {
					if (newValue == null) {newValue = 0;}
					currentElimRecordData.push({
						source: "r" + round + "-" + loser,
						target: "r" + (round+1) + "-" + can1,
						value: newValue / totalBorda_new - oldValue / totalBorda_old 
					});
				}
			}
		}
		
		round++;
	}
	return testCARS.condorcetWinner != null ? [testCARS.condorcetWinner, testCARS.condorcetLoser] : [testCARS.cs];
}

function RCIPETest(myCARS) {
	let testCARS = myCARS;
	let prevCARS;
	let round = 0;
	let loser = -1;
	
	while (testCARS.cs.length > 2) {	
		if (testCARS.condorcetLoser != null) { loser = testCARS.condorcetLoser; }
		else {
			for (let i = testCARS.sortedFirstRankVotes.length - 1; i > -1; i--) {
				loser = testCARS.sortedFirstRankVotes[i];
				if (testCARS.cs.includes(loser)) {break;}
			}
		}
			
		let newCS = testCARS.cs.filter(c => c !== loser);
		prevCARS = testCARS;
		testCARS = new CARS(newCS, false, testCARS, "ordinal", testCARS.attacker, testCARS.target, testCARS.counterStrategy, testCARS.partisanMask);
		if (isCurrentlyRecordingElimData) {
			for (let c1 = 0; c1 < myCARS.sortedFirstRankVotes.length; c1++) {
				let can1 = myCARS.sortedFirstRankVotes[c1];
				if (!(prevCARS.cs.includes(can1))) {continue;}
				if (can1 == loser) {continue;}
				let oldValue = prevCARS.firstRankVotes[can1];
				if (oldValue != null) {
					currentElimRecordData.push({
						source: "r" + round + "-" + can1,
						target: "r" + (round+1) + "-" + can1,
						value: oldValue
					});
				}
			}
			for (let c1 = 0; c1 < myCARS.sortedFirstRankVotes.length; c1++) {
				let can1 = myCARS.sortedFirstRankVotes[c1];
				if (!(prevCARS.cs.includes(can1))) {continue;}
				if (can1 == loser) {continue;}
				let oldValue = prevCARS.firstRankVotes[can1];
				let newValue = testCARS.firstRankVotes[can1];
				if (oldValue != null) {
					if (newValue == null) {newValue = 0;}
					currentElimRecordData.push({
						source: "r" + round + "-" + loser,
						target: "r" + (round+1) + "-" + can1,
						value: newValue - oldValue
					});
				}
			}
		}
		
		round++;
	}
	return testCARS.sortedFirstRankVotes;
}

function BTRTest(myCARS) {
	let testCARS = myCARS;
	let prevCARS;
	let round = 0;
	let loser = -1;
	let runoff1 = -1;
	let runoff2 = -1;
	
	while (testCARS.cs.length > 1) {
		let i = testCARS.sortedFirstRankVotes.length - 1;
		for (i; i > -1; i--) {
			runoff1 = testCARS.sortedFirstRankVotes[i];
			if (testCARS.cs.includes(runoff1)) {break;}
		}
		for (i--; i > -1; i--) {
			runoff2 = testCARS.sortedFirstRankVotes[i];
			if (testCARS.cs.includes(runoff2)) {break;}
		}
		let winner = -1;
		if (myCARS.results[runoff1][runoff2] > myCARS.results[runoff2][runoff1] ||
			(myCARS.results[runoff1][runoff2] == myCARS.results[runoff2][runoff1] && runoff1 < runoff2)) {
			winner = runoff1;
			loser = runoff2;
		} else {
			winner = runoff2;
			loser = runoff1;
		}
		if (testCARS.cs.length == 2) {
			return [winner, loser];
		}
		
		let newCS = testCARS.cs.filter(c => c !== loser);
		prevCARS = testCARS;
		testCARS = new CARS(newCS, false, testCARS, "ordinal", testCARS.attacker, testCARS.target, testCARS.counterStrategy, testCARS.partisanMask);
		if (isCurrentlyRecordingElimData) {
			for (let c1 = 0; c1 < myCARS.sortedFirstRankVotes.length; c1++) {
				let can1 = myCARS.sortedFirstRankVotes[c1];
				if (!(prevCARS.cs.includes(can1))) {continue;}
				if (can1 == loser) {continue;}
				let oldValue = prevCARS.firstRankVotes[can1];
				if (oldValue != null) {
					currentElimRecordData.push({
						source: "r" + round + "-" + can1,
						target: "r" + (round+1) + "-" + can1,
						value: oldValue
					});
				}
			}
			for (let c1 = 0; c1 < myCARS.sortedFirstRankVotes.length; c1++) {
				let can1 = myCARS.sortedFirstRankVotes[c1];
				if (!(prevCARS.cs.includes(can1))) {continue;}
				if (can1 == loser) {continue;}
				let oldValue = prevCARS.firstRankVotes[can1];
				let newValue = testCARS.firstRankVotes[can1];
				if (oldValue != null) {
					if (newValue == null) {newValue = 0;}
					currentElimRecordData.push({
						source: "r" + round + "-" + loser,
						target: "r" + (round+1) + "-" + can1,
						value: newValue - oldValue
					});
				}
			}
			
			//find UMB data -- which eliminations "protect" a weaker survivor
			//		from a candidate who could eventually beat them?
			//"If x-y voters change their vote to winner A from loser B, it actually makes C replace A as winner."
			//		elimUMFData[A][B][C] = [x,y]		current eliminated loser is C
			for (let c1 = 0; c1 < newCS.length; c1++) {
				let can1 = newCS[c1];
				let marginOfUltimateVictory = prevCARS.results[loser][can1] - prevCARS.results[can1][loser]; //how much C ultimately beats A, given the chance to face off
				if (marginOfUltimateVictory < 0) {continue;}
				for (let c2 = 0; c2 < newCS.length; c2++) {
					if (c1 == c2) {continue;}
					let can2 = newCS[c2];
					
					//check to see if someone else besides B would eliminate C anyway next round, no matter what
					let isHopeless = false;
					let bestCaseNextRound = prevCARS.firstRankVotes[can2] + prevCARS.firstRankVotes[loser];
					for (let c3 = 0; c3 < newCS.length; c3++) {
						if (c2 == c3) {continue;}
						let can3 = newCS[c3];
						if (bestCaseNextRound < prevCARS.firstRankVotes[can3])
						{ isHopeless = true; } //this is conservative...
					}
					if (isHopeless) {continue;}
					
					let marginOfElimination = prevCARS.firstRankVotes[can2] - prevCARS.firstRankVotes[loser]; //how much A is beating C
					
					let nonCostlyChanges = 0; //how many votes can change to A from B without cutting into C's margin over A; (B>A>C)
					for (let i = 0; i < voter_data.length; i++) {
						let voter = voter_data[i];
						if (voter[2][can2] < voter[2][can1] && voter[2][can1] < voter[2][loser]) {nonCostlyChanges++;}
					}
					
					let budget = nonCostlyChanges + marginOfUltimateVictory/2;
					if (marginOfElimination < budget) { //is this change possible in our "budget"?
						if (!(can1 in currentElimUMFData)) {currentElimUMFData[can1] = {};}
						if (!(can2 in currentElimUMFData[can1])) {currentElimUMFData[can1][can2] = {};}
						currentElimUMFData[can1][can2][loser] = [marginOfElimination, budget];
					}
				}
			}
			
			//find DMB data -- pushover
			//"If x-y voters change their vote to loser B from loser C, it actually makes loser C win by eliminating the normal winner A that would ultimately defeat C."
			//		elimLMFData[A][B][C] = [x,y]		current eliminated loser is B
			for (let c1 = 0; c1 < newCS.length; c1++) {
				let can1 = newCS[c1];
				let marginOfElimination = prevCARS.firstRankVotes[can1] - prevCARS.firstRankVotes[loser]; //how narrowly did A avoid elimination?
				for (let c3 = 0; c3 < newCS.length; c3++) {
					if (c1 == c3) {continue;}
					let can3 = newCS[c3];
					let marginOfUltimateVictory = prevCARS.results[can3][loser] - prevCARS.results[loser][can3]; //how much C ultimately beats B, given the chance to face off
					
					//note: all votes are "costly" here; every vote that goes from C --> B penalizes C fighting B later
					
					let budget = Math.min(prevCARS.firstRankVotes[can3] - prevCARS.firstRankVotes[can1], //elim now
					                      testCARS.firstRankVotes[can3] - Math.min(...testCARS.firstRankVotes), //elim next
					                      marginOfUltimateVictory/2); //at this point C would lose to B
					if (marginOfElimination < budget) //within budget
					{
						if (!(can1 in currentElimDMFData)) {currentElimDMFData[can1] = {};}
						if (!(loser in currentElimDMFData[can1])) {currentElimDMFData[can1][loser] = {};}
						currentElimDMFData[can1][loser][can3] = [marginOfElimination, budget];
					}
				}
			}
		}
		round++;
	}
	return [testCARS.cs[0]]; //should always return internally
}
function CoombsTest(myCARS, smithCheck = false) {
	let testCARS = myCARS;
	let prevCARS;
	let round = 0;
	let loser = -1;
	while (testCARS.cs.length > 2) {
		for (let i = testCARS.sortedLastRankVotes.length - 1; i > -1; i--) {
			loser = testCARS.sortedLastRankVotes[i];
			if (testCARS.cs.includes(loser)) {break;}
		}
		let newCS = testCARS.cs.filter(c => c !== loser);
		prevCARS = testCARS;
		testCARS = new CARS(newCS, false, testCARS, "ordinal", testCARS.attacker, testCARS.target, testCARS.counterStrategy, testCARS.partisanMask);
		
		if (isCurrentlyRecordingElimData) {
			for (let c1 = 0; c1 < prevCARS.sortedLastRankVotes.length; c1++) {
				let can1 = prevCARS.sortedLastRankVotes[c1];
				if (!(prevCARS.cs.includes(can1))) {continue;}
				if (can1 == loser) {continue;}
				let oldValue = prevCARS.lastRankVotes[can1];
				if (oldValue != null) {
					currentElimRecordData.push({
						source: "r" + round + "-" + can1,
						target: "r" + (round+1) + "-" + can1,
						value: oldValue
					});
				}
			}
			for (let c1 = 0; c1 < prevCARS.sortedLastRankVotes.length; c1++) {
				let can1 = prevCARS.sortedLastRankVotes[c1];
				if (!(prevCARS.cs.includes(can1))) {continue;}
				if (can1 == loser) {continue;}
				let oldValue = prevCARS.lastRankVotes[can1];
				let newValue = testCARS.lastRankVotes[can1];
				if (oldValue != null) {
					if (newValue == null) {newValue = 0;}
					currentElimRecordData.push({
						source: "r" + round + "-" + loser,
						target: "r" + (round+1) + "-" + can1,
						value: newValue - oldValue
					});
				}
			}
			
			//find UMB data -- which eliminations "protect" a weaker survivor
			//		from a candidate who could eventually beat them?
			//"If x-y voters change their vote to winner A from loser B, it actually makes C replace A as winner."
			//		elimUMFData[A][B][C] = [x,y]		current eliminated loser is C
			for (let c1 = 0; c1 < newCS.length; c1++) {
				let can1 = newCS[c1];
				let marginOfUltimateVictory = prevCARS.results[loser][can1] - prevCARS.results[can1][loser]; //how much C ultimately beats A, given the chance to face off
				if (marginOfUltimateVictory < 0) {continue;}
				for (let c2 = 0; c2 < newCS.length; c2++) {
					if (c1 == c2) {continue;}
					let can2 = newCS[c2];
					
					//it's always possible that all the eliminated party's votes flow to the same, next victim; never hopeless
					
					let marginOfElimination = -(prevCARS.lastRankVotes[can2] - prevCARS.lastRankVotes[loser]); //how much A is beating C
					
					let nonCostlyChanges = 0; //how many votes can change to A from B without cutting into C's margin over A; (B>A>C)
					for (let i = 0; i < voter_data.length; i++) {
						let voter = voter_data[i];
						if (voter[2][can2] < voter[2][can1] && voter[2][can1] < voter[2][loser]) {nonCostlyChanges++;}
					}
					
					let budget = nonCostlyChanges + marginOfUltimateVictory/2;
					if (marginOfElimination < budget) { //is this change possible in our "budget"?
						if (!(can1 in currentElimUMFData)) {currentElimUMFData[can1] = {};}
						if (!(can2 in currentElimUMFData[can1])) {currentElimUMFData[can1][can2] = {};}
						currentElimUMFData[can1][can2][loser] = [marginOfElimination, budget];
					}
				}
			}
			
			//find DMB data -- pushover
			//"If x-y voters change their vote to loser B from loser C, it actually makes loser C win by eliminating the normal winner A that would ultimately defeat C."
			//		elimLMFData[A][B][C] = [x,y]		current eliminated loser is B
			for (let c1 = 0; c1 < newCS.length; c1++) {
				let can1 = newCS[c1];
				let marginOfElimination = -(prevCARS.lastRankVotes[can1] - prevCARS.lastRankVotes[loser]); //how narrowly did A avoid elimination?
				for (let c3 = 0; c3 < newCS.length; c3++) {
					if (c1 == c3) {continue;}
					let can3 = newCS[c3];
					let marginOfUltimateVictory = prevCARS.results[can3][loser] - prevCARS.results[loser][can3]; //how much C ultimately beats B, given the chance to face off
					
					//note: all votes are "costly" here; every vote that goes from C --> B penalizes C fighting B later
					
					let budget = Math.min(marginOfUltimateVictory/2); //at this point C would lose to B
					if (marginOfElimination < budget) //within budget
					{
						if (!(can1 in currentElimDMFData)) {currentElimDMFData[can1] = {};}
						if (!(loser in currentElimDMFData[can1])) {currentElimDMFData[can1][loser] = {};}
						currentElimDMFData[can1][loser][can3] = [marginOfElimination, budget];
					}
				}
			}
		}
		round++;
		
		if (smithCheck) {
			if (testCARS.smithSet != null && testCARS.smithSet.length == 1) { return testCARS.smithSet; }
			if (testCARS.smithSet.length < testCARS.cs.length) {
				testCARS = new CARS(testCARS.smithSet, false, testCARS, "ordinal", testCARS.attacker, testCARS.target, testCARS.counterStrategy, testCARS.partisanMask);
			}
		}
	}
	return testCARS.sortedFirstRankVotes;
}
function DowdallTest(myCARS, smithCheck = false) {
	let testCARS = myCARS;
	let prevCARS;
	let round = 0;
	let loser = -1;
	while (testCARS.cs.length > 2) {
		for (let i = testCARS.sortedDowdallScores.length - 1; i > -1; i--) {
			loser = testCARS.sortedDowdallScores[i];
			if (testCARS.cs.includes(loser)) {break;}
		}
		let newCS = testCARS.cs.filter(c => c !== loser);
		prevCARS = testCARS;
		testCARS = new CARS(newCS, false, testCARS, "ordinal", testCARS.attacker, testCARS.target, testCARS.counterStrategy, testCARS.partisanMask);
		
		if (isCurrentlyRecordingElimData) {
			let totalDowdall_old = 0;
			let totalDowdall_new = 0;
			for (c1 = 0; c1 < prevCARS.dowdallScores.length; c1++) {
				if (prevCARS.dowdallScores[c1]) {
					totalDowdall_old += prevCARS.dowdallScores[c1];
				}
			}
			for (let c1 = 0; c1 < testCARS.dowdallScores.length; c1++) {
				if (testCARS.dowdallScores[c1]) {
					totalDowdall_new += testCARS.dowdallScores[c1];
				}
			}
			for (let c1 = 0; c1 < myCARS.sortedDowdallScores.length; c1++) {
				let can1 = myCARS.sortedDowdallScores[c1];
				if (!(myCARS.cs.includes(can1))) {continue;}
				if (can1 == loser) {continue;}
				let oldValue = myCARS.dowdallScores[can1];
				if (oldValue != null) {
					currentElimRecordData.push({
						source: "r" + round + "-" + can1,
						target: "r" + (round+1) + "-" + can1,
						value: oldValue / totalDowdall_old
					});
				}
			}
			for (let c1 = 0; c1 < myCARS.sortedDowdallScores.length; c1++) {
				let can1 = myCARS.sortedDowdallScores[c1];
				if (!(myCARS.cs.includes(can1))) {continue;}
				if (can1 == loser) {continue;}
				let oldValue = myCARS.dowdallScores[can1];
				let newValue = testCARS.dowdallScores[can1];
				if (oldValue != null) {
					if (newValue == null) {newValue = 0;}
					currentElimRecordData.push({
						source: "r" + round + "-" + loser,
						target: "r" + (round+1) + "-" + can1,
						value: newValue / totalDowdall_new - oldValue / totalDowdall_old 
					});
				}
			}
		}
		round++;
		
		if (smithCheck) {
			if (testCARS.smithSet != null && testCARS.smithSet.length == 1) { return testCARS.smithSet; }
			if (testCARS.smithSet.length < testCARS.cs.length) {
				testCARS = new CARS(testCARS.smithSet, false, testCARS, "ordinal", testCARS.attacker, testCARS.target, testCARS.counterStrategy, testCARS.partisanMask);
			}
		}
	}
	return testCARS.sortedFirstRankVotes;
}
function BordaTest(myCARS, smithCheck = false) {
	let testCARS = myCARS;
	let prevCARS;
	let round = 0;
	let loser = -1;
	while (testCARS.cs.length > 2) {
		for (let i = testCARS.sortedBordaScores.length - 1; i > -1; i--) {
			loser = testCARS.sortedBordaScores[i];
			if (testCARS.cs.includes(loser)) {break;}
		}
		let newCS = testCARS.cs.filter(c => c !== loser);
		prevCARS = testCARS;
		testCARS = new CARS(newCS, false, testCARS, "ordinal", testCARS.attacker, testCARS.target, testCARS.counterStrategy, testCARS.partisanMask);
		
		if (isCurrentlyRecordingElimData) {
			let totalBorda_old = 0;
			let totalBorda_new = 0;
			for (let c1 = 0; c1 < prevCARS.bordaScores.length; c1++) {
				if (prevCARS.bordaScores[c1]) {
					totalBorda_old += prevCARS.bordaScores[c1];
				}
			}
			for (let c1 = 0; c1 < testCARS.bordaScores.length; c1++) {
				if (testCARS.bordaScores[c1]) {
					totalBorda_new += testCARS.bordaScores[c1];
				}
			}
			
			for (let c1 = 0; c1 < prevCARS.sortedBordaScores.length; c1++) {
				let can1 = prevCARS.sortedBordaScores[c1];
				if (can1 == loser) {continue;}
				let oldValue = prevCARS.bordaScores[can1];
				if (oldValue != null) {
					currentElimRecordData.push({
						source: "r" + round + "-" + can1,
						target: "r" + (round+1) + "-" + can1,
						value: oldValue / totalBorda_old
					});
				}
			}
			for (let c1 = 0; c1 < prevCARS.sortedBordaScores.length; c1++) {
				let can1 = prevCARS.sortedBordaScores[c1];
				if (can1 == loser) {continue;}
				let oldValue = prevCARS.bordaScores[can1];
				let newValue = testCARS.bordaScores[can1];
				if (oldValue != null) {
					if (newValue == null) {newValue = 0;}
					currentElimRecordData.push({
						source: "r" + round + "-" + loser,
						target: "r" + (round+1) + "-" + can1,
						value: newValue / totalBorda_new - oldValue / totalBorda_old 
					});
				}
			}
			
			//find UMB data -- which eliminations "protect" a weaker survivor
			//		from a candidate who could eventually beat them?
			//"If x-y voters change their vote to winner A from loser B, it actually makes C replace A as winner."
			//		elimUMFData[A][B][C] = [x,y]		current eliminated loser is C
			for (let c1 = 0; c1 < newCS.length; c1++) {
				let can1 = newCS[c1];
				let marginOfUltimateVictory = prevCARS.results[loser][can1] - prevCARS.results[can1][loser]; //how much C ultimately beats A, given the chance to face off
				if (marginOfUltimateVictory < 0) {continue;}
				for (let c2 = 0; c2 < newCS.length; c2++) {
					if (c1 == c2) {continue;}
					let can2 = newCS[c2];
					
					/*
					//check to see if someone else besides B would eliminate C anyway next round, no matter what
					let isHopeless = false;
					for (let c3 = 0; c3 < newCS.length; c3++) {
						if (c2 == c3) {continue;}
						let can3 = newCS[c3];
						if (prevCARS.bordaScores[can2] < prevCARS.firstRankVotes[can3])
						{ isHopeless = true; } //this is conservative...
					}
					if (isHopeless) {continue;}
					*/
					
					let marginOfElimination = prevCARS.bordaScores[can2] - prevCARS.bordaScores[loser]; //how much B is beating C
					
					let nonCostlyChanges = 0; //how many votes can change to A from B without cutting into C's *final* margin over A; (B>A>C)
					for (let i = 0; i < voter_data.length; i++) {
						let voter = voter_data[i];
						if (voter[2][can2] < voter[2][can1] && voter[2][can1] < voter[2][loser]) {nonCostlyChanges++;}
					}
					
					let budget = nonCostlyChanges + marginOfUltimateVictory/2;
					if (marginOfElimination < budget) { //is this change possible in our "budget"?
						if (!(can1 in currentElimUMFData)) {currentElimUMFData[can1] = {};}
						if (!(can2 in currentElimUMFData[can1])) {currentElimUMFData[can1][can2] = {};}
						currentElimUMFData[can1][can2][loser] = [marginOfElimination, budget];
					}
				}
			}
			
			//find DMB data -- pushover
			//"If x-y voters change their vote to loser B from loser C, it actually makes loser C win by eliminating the normal winner A that would ultimately defeat C."
			//		elimLMFData[A][B][C] = [x,y]		current eliminated loser is B
			for (let c1 = 0; c1 < newCS.length; c1++) {
				let can1 = newCS[c1];
				let marginOfElimination = prevCARS.bordaScores[can1] - prevCARS.bordaScores[loser]; //how narrowly did A avoid elimination?
				for (let c3 = 0; c3 < newCS.length; c3++) {
					if (c1 == c3) {continue;}
					let can3 = newCS[c3];
					let marginOfUltimateVictory = prevCARS.results[can3][loser] - prevCARS.results[loser][can3]; //how much C ultimately beats B, given the chance to face off
					
					//note: all votes are "costly" here; every vote that goes from C --> B penalizes C fighting B later
					
					let budget = Math.min(prevCARS.bordaScores[can3] - prevCARS.bordaScores[can1], //elim now
					                      testCARS.bordaScores[can3] - Math.min(...testCARS.bordaScores), //elim next
					                      marginOfUltimateVictory/2); //at this point C would lose to B
					if (marginOfElimination < budget) //within budget
					{
						if (!(can1 in currentElimDMFData)) {currentElimDMFData[can1] = {};}
						if (!(loser in currentElimDMFData[can1])) {currentElimDMFData[can1][loser] = {};}
						currentElimDMFData[can1][loser][can3] = [marginOfElimination, budget];
					}
				}
			}
		}
		round++;
		
		if (smithCheck) {
			if (testCARS.smithSet != null && testCARS.smithSet.length == 1) { return testCARS.smithSet; }
			if (testCARS.smithSet.length < testCARS.cs.length) {
				testCARS = new CARS(testCARS.smithSet, false, testCARS, "ordinal", testCARS.attacker, testCARS.target, testCARS.counterStrategy, testCARS.partisanMask);
			}
		}
	}
	return testCARS.sortedFirstRankVotes;
}
function MinimaxTest(myCARS, altList = null) {
	let myList = myCARS.cs;
	if (altList != null) {myList = altList;} //lets us run minimax on arbitrary subsets
	let winner;
	let bestLowestMargin = 0;
	for (let c1 = 0; c1 < myList.length; c1++) {
		let can1 = myList[c1];
		let myLowestMargin = 1;
		for (let c2 = 0; c2 < myList.length; c2++) {
			if (c1 == c2) {continue;}
			let can2 = myList[c2];
			myLowestMargin = Math.min(myLowestMargin, myCARS.resultsPercentile[can1][can2]);
		}
		if (myLowestMargin > bestLowestMargin) {
			winner = can1;
			bestLowestMargin = myLowestMargin;
		}
	}
	return [winner, -1];
}

/*   this is bad!

function NormRangeMinimaxTest(myCARS) {
	let winner;
	let bestLowestMargin = 0;
	for (let c1 = 0; c1 < myCARS.cs.length; c1++) {
		let can1 = myCARS.cs[c1];
		console.log(can1 + " score: " + myCARS.totalNormalizedDistance[can1]);
		let myLowestMargin = 1;
		for (let c2 = 0; c2 < myCARS.cs.length; c2++) {
			if (c1 == c2) {continue;}
			let can2 = myCARS.cs[c2];
			let score1 = myCARS.totalNormalizedDistance[can1];
			let score2 = myCARS.totalNormalizedDistance[can2];
			console.log(can1 + " vs " + can2 + ": " + (1 - score1 / (score1 + score2)));
			myLowestMargin = Math.min(myLowestMargin, 1 - score1 / (score1 + score2));
		}
		if (myLowestMargin > bestLowestMargin) {
			winner = can1;
			bestLowestMargin = myLowestMargin;
		}
		console.log(can1 + " " + bestLowestMargin);
	}
	return [winner,-1];
} */

function RankedPairsTest(myCARS) {
	let c = candidate_data.length;
	let children = new Array(c).fill(0).map(() => new Array(0));
	let grandchild;
	let edges = [];
	for (let c1 = 0; c1 < myCARS.cs.length; c1++) {
		let can1 = myCARS.cs[c1];
		for (let c2 = 0; c2 < myCARS.cs.length; c2++) {
			if (c1 == c2) {continue;}
			let can2 = myCARS.cs[c2];
			let r = myCARS.resultsPercentile[can1][can2];
			if (r >= 0.5) {edges.push([can1, can2, r]);}
		}
	}
	edges.sort((a,b) => b[2] - a[2]);
	for (let i = 0; i < edges.length; i++) {
		let e = edges[i];
		if (children[e[0]].includes(e[1])) { continue; }
		if (children[e[1]].includes(e[0])) { continue; }
		children[e[0]].push(e[1]);
		for (let g = 0; g < children[e[1]].length; g++) {
			grandchild = children[e[1]][g];
			if (!children[e[0]].includes(grandchild)) { children[e[0]].push(grandchild); }
		}
		for (let j = 0; j < children.length; j++) {
			if (j == e[0] || j == e[1]) {continue;}
			if (children[j].includes(e[0]) && ! children[j].includes(e[1])) {
				for (let g = 0; g < children[e[0]].length; g++) {
					grandchild = children[e[0]][g];
					if (!children[j].includes(grandchild)) { children[j].push(grandchild); }
				}
			}
		}
	}
	let winner = null;
	let mostChildren = 0;
	for (let c1 = 0; c1 < myCARS.cs.length; c1++) {
		let can1 = myCARS.cs[c1];
		if (children[can1].length > mostChildren) {
			winner = can1;
			mostChildren = children[can1].length;
		}
	}
	return [winner, -1];
}
function StableVotingTest(myCARS) {
	if (myCARS.smithSet.length < 4) { return MinimaxTest(myCARS, myCARS.smithSet); }	
	let testCARS = myCARS;
	let prevCARS = null;
	
	let edges = [];
	for (let c1 = 0; c1 < myCARS.cs.length; c1++) {
		let can1 = myCARS.cs[c1];
		for (let c2 = 0; c2 < myCARS.cs.length; c2++) {
			if (c1 == c2) {continue;}
			let can2 = myCARS.cs[c2];
			let r = myCARS.resultsPercentile[can1][can2];
			if (r >= 0.5) {edges.push([can1, can2, r]);}
		}
	}
	edges.sort((a,b) => b[2] - a[2]);
	for (let i = 0; i < edges.length; i++) {
		let e = edges[i];
		let newCS = testCARS.cs.filter(c => c !== e[1]);
		if (newCS.length == 1) {return [newCS[0],-1];}
		prevCARS = testCARS;
		testCARS = new CARS(newCS, false, testCARS, null, testCARS.attacker, testCARS.target, testCARS.counterStrategy, testCARS.partisanMask);
		let winner = StableVotingTest(testCARS);
		if (winner == e[0]) { return [winner, -1]; }
	}
	return [null, null];
}
function SchulzeTest(myCARS) {
	let c = myCARS.cs.length;
	let sps = new Array(c).fill(0).map(() => new Array(c).fill(0));
	for (let i = 0; i < c; i++) {
		let x = myCARS.cs[i];
		for (let j = 0; j < c; j++) {
			if (i == j) {continue;}
			let y = myCARS.cs[j];
			if (myCARS.resultsPercentile[x][y] > 0.5) { sps[i][j] = myCARS.resultsPercentile[x][y]; }
		}
	}
	for (let i = 0; i < c; i++) {
		for (let j = 0; j < c; j++) {
			if (i == j) {continue;}
			for (let k = 0; k < c; k++) {
				if (i == k || j == k) {continue;}
				sps[j][k] = Math.max(sps[j][k], Math.min(sps[j][i],sps[i][k]));
			}
		}
	}
	for (let i = 0; i < c; i++) {
		let lost = false;
		for (let j = 0; j < c; j++) {
			if (i == j) { continue; }
			if (sps[i][j] <= sps[j][i]) {lost = true; break;}
		}
		if (!lost) { return [myCARS.cs[i],-1]; }
	}
	//return null;
	return [-1]; //total tie error handling
}

function IterativeNormalizationTest(myCARS, smithCheck = false) {
	let testCARS = myCARS;
	let prevCARS;
	let round = 0;
	let loser = -1;
	while (testCARS.cs.length > 2) {
		for (let i = testCARS.sortedTotalNormalizedDistance.length - 1; i > -1; i--) {
			loser = testCARS.sortedTotalNormalizedDistance[i];
			if (testCARS.cs.includes(loser)) {break;}
		}
		let newCS = testCARS.cs.filter(c => c !== loser);
		prevCARS = testCARS;
		testCARS = new CARS(newCS, false, testCARS, "cardinal", testCARS.attacker, testCARS.target, testCARS.counterStrategy);
		
		if (isCurrentlyRecordingElimData) {
			let totalNormDistance_old = 0;
			let totalNormDistance_new = 0;
			for (let c1 = 0; c1 < prevCARS.totalNormalizedDistance.length; c1++) {
				if (prevCARS.totalNormalizedDistance[c1]) {
					totalNormDistance_old += prevCARS.totalNormalizedDistance[c1];
				}
			}
			for (let c1 = 0; c1 < testCARS.totalNormalizedDistance.length; c1++) {
				if (testCARS.totalNormalizedDistance[c1]) {
					totalNormDistance_new += testCARS.totalNormalizedDistance[c1];
				}
			}
			
			for (let c1 = 0; c1 < prevCARS.sortedTotalNormalizedDistance.length; c1++) {
				let can1 = prevCARS.sortedTotalNormalizedDistance[c1];
				if (!(prevCARS.cs.includes(can1))) {continue;}
				if (can1 == loser) {continue;}
				let oldValue = prevCARS.totalNormalizedDistance[can1];
				if (oldValue != null) {
					oldValue = voter_data.length - oldValue;
					currentElimRecordData.push({
						source: "r" + round + "-" + can1,
						target: "r" + (round+1) + "-" + can1,
						value: (oldValue)// / totalNormDistance_old
					});
				}
			}
			for (let c1 = 0; c1 < prevCARS.sortedTotalNormalizedDistance.length; c1++) {
				let can1 = prevCARS.sortedTotalNormalizedDistance[c1];
				if (!(prevCARS.cs.includes(can1))) {continue;}
				if (can1 == loser) {continue;}
				let oldValue = prevCARS.totalNormalizedDistance[can1];
				let newValue = testCARS.totalNormalizedDistance[can1];
				if (oldValue != null) {
					oldValue = voter_data.length - oldValue;
					newValue = (newValue == null) ? 0 : voter_data.length - newValue;
					currentElimRecordData.push({
						source: "r" + round + "-" + loser,
						target: "r" + (round+1) + "-" + can1,
						value: (oldValue - newValue)// / totalNormDistance_new
					});
				}
			}
		}
		round++;
		
		if (smithCheck) {
			if (testCARS.smithSet.length == 1) { return testCARS.smithSet; }
			if (testCARS.smithSet.length < testCARS.cs.length) {
				testCARS = new CARS(testCARS.smithSet, false, testCARS, "cardinal", testCARS.attacker, testCARS.target, testCARS.counterStrategy, testCARS.partisanMask);
			}
		}
	}
	return testCARS.sortedTotalNormalizedDistance;
}

class MRD { //method result data
	
	methodID;
	naturalWinner;
	runnerUp;
	strategicDominantWinners;
	strategicReversibleWinners;
	strategicWithdrawVulnerableWinners
	strategicAntiPluralityWinners;
	strategicCrossoverWinners;
	strategicAttackingPairs; //hashmap
	strategicCloneWinners;
	strategicKingmakers;
	strategicBackfires;
	strategicCounterstrategyBackfires;
	elimData;
	wastedVotes;
	
	constructor(methodID, isDetailed = true) {
		this.methodID = methodID;
		let methodStr = methodList[methodID];
		this.strategicDominantWinners = [];
		this.strategicReversibleWinners = [];
		this.strategicWithdrawVulnerableWinners = {};
		this.strategicAntiPluralityWinners = [];
		this.strategicCrossoverWinners = [];
		this.strategicAttackingPairs = {};
		this.strategicCloneWinners = [];
		this.strategicKingmakers = [];
		this.strategicBackfires = [];
		this.strategicCounterstrategyBackfires = [];
		
		let myCARS = baseCARS;
		let victoryFunctions;
		
		switch(methodStr) {
		case "PartyPlurality":		
			victoryFunctions = [c => c.sortedFirstRankVotes];
			break;
		case "PartyHare":		
			victoryFunctions = [c => HareTest(c)];
			break;
		case "PartyApproval":		
			victoryFunctions = [c => c.sortedTotalApprovalScores];
			break;
		case "PartyMinimax":		
			victoryFunctions = [c => MinimaxTest(c)];
			break;
		case "LT-PartyPlurality":		
			victoryFunctions = [c => c.sortedFirstRankVotes];
			break;
		case "LT-PartyHare":		
			victoryFunctions = [c => HareTest(c)];
			break;
		case "LT-PartyApproval":		
			victoryFunctions = [c => c.sortedTotalApprovalScores];
			break;
		case "LT-PartyMinimax":		
			victoryFunctions = [c => MinimaxTest(c)];
			break;
		case "Plurality":
			victoryFunctions = [c => c.sortedFirstRankVotes];
			break;
		case "Dowdall":
			victoryFunctions = [c => c.sortedDowdallScores];
			break;
		case "Borda":
			victoryFunctions = [c => c.sortedBordaScores];
			break;
		case "AntiPlurality":
			victoryFunctions = [c => c.sortedLastRankVotes];
			break;
		case "Top2Runoff":
			victoryFunctions = [c => {
				if (c.cs.length == 1) {return c.cs;}
				let finalist1 = c.sortedFirstRankVotes[0];
				let finalist2 = c.sortedFirstRankVotes[1];
				return (c.results[finalist1][finalist2] >= c.results[finalist2][finalist1] ||
				        (c.results[finalist1][finalist2] == c.results[finalist2][finalist1] &&
				         finalist1 < finalist2)) ? [finalist1, finalist2] : [finalist2, finalist1];
			}];
			break;
		case "Hare (IRV)":
			victoryFunctions = [c => HareTest(c)];
			break;
		case "Contingency":
			victoryFunctions = [c => HareTest(c, false, false, false, false, true)];
			break;
		case "Coombs":
			victoryFunctions = [c => CoombsTest(c)];
			break;

		case "RawRange":
			victoryFunctions = [c => c.sortedTotalLinearDistance];
			break;
		case "NormalRange":
			victoryFunctions = [c => c.sortedTotalNormalizedDistance];
			break;
		case "ItNormRange":
			victoryFunctions = [c => IterativeNormalizationTest(c)];
			break;
		case "Approval":
			victoryFunctions = [c => c.sortedTotalApprovalScores];
			break;
		case "Median":
			victoryFunctions = [c => c.sortedMedianScores];
			break;
		case "V321":
			victoryFunctions = [c => {
				if (c.cs.length == 1) {return c.cs;}
				if (c.cs.length == 2) {return c.sortedFirstRankVotes;}
				let semifinalist1 = c.sortedTotalApprovalScores[0];
				let semifinalist2 = c.sortedTotalApprovalScores[1];
				let semifinalist3 = c.sortedTotalApprovalScores[2];
				let finalist1 = semifinalist1;
				let finalist2 = semifinalist2;
				let eliminated = semifinalist3;
				if        (c.lastRankVotes[semifinalist1] > c.lastRankVotes[semifinalist2] &&
				           c.lastRankVotes[semifinalist1] > c.lastRankVotes[semifinalist3]) {
					finalist1 = semifinalist3;
					eliminated = semifinalist1;
				} else if (c.lastRankVotes[semifinalist2] > c.lastRankVotes[semifinalist1] &&
				           c.lastRankVotes[semifinalist2] > c.lastRankVotes[semifinalist3]) {
					finalist2 = semifinalist3;
					eliminated = semifinalist2;
				}
				if (c.results[finalist1] == null) {return finalist2;}
				if (c.results[finalist2] == null) {return finalist1;}
				return (c.results[finalist1][finalist2] > c.results[finalist2][finalist1]) ? [finalist1, finalist2, eliminated]
				                                                                           : [finalist2, finalist1, eliminated];
			}];
			break;
		case "ApprovalRunoff":
			victoryFunctions = [c => {
				if (c.cs.length == 1) {return c.cs;}
				let runoff1 = c.sortedTotalApprovalScores[0];
				let runoff2 = c.sortedTotalApprovalScores[1];
				if (c.results[runoff1] == null) {return [runoff2, -1];}
				if (c.results[runoff2] == null) {return [runoff1, -1];}
				return (c.results[runoff1][runoff2] > c.results[runoff2][runoff1] ||
				        (c.results[runoff1][runoff2] == c.results[runoff2][runoff1] && runoff1 < runoff2)) ? 
				            [runoff1, runoff2] : [runoff2, runoff1];
			}];
			break;
		case "STAR":
			victoryFunctions = [c => {
				if (c.cs.length == 1) {return c.cs;}
				let runoff1 = c.sortedTotalNormalizedDistance[0];
				let runoff2 = c.sortedTotalNormalizedDistance[1];
				if (c.results[runoff1] == null) {return [runoff2, -1];}
				if (c.results[runoff2] == null) {return [runoff1, -1];}
				return (c.results[runoff1][runoff2] > c.results[runoff2][runoff1] ||
				        (c.results[runoff1][runoff2] == c.results[runoff2][runoff1] && runoff1 < runoff2)) ? 
				            [runoff1, runoff2] : [runoff2, runoff1];
			}];
			break;
		case "STAR3":
			victoryFunctions = [c => {
				if (c.cs.length == 1) {return c.cs;}
				if (c.cs.length == 2) {return c.results[c.cs[0]][c.cs[1]] > c.results[c.cs[1]][c.cs[0]] ?
				                              [c.cs[0], c.cs[1]] : [c.cs[1], c.cs[0]];}
				if (c.cs.length == 3) {return MinimaxTest(c);}
				let newCS = c.sortedTotalNormalizedDistance.slice(0,3);
				return MinimaxTest(c, newCS);
			}];
			break;

		case "Condorcet//Plurality":
			victoryFunctions = [c => c.smithSet.length == 1 ? c.smithSet : null,
			                    c => c.sortedFirstRankVotes];
			break;
		case "Smith//Plurality":
			myCARS = smithCARS;
			victoryFunctions = [c => c.smithSet.length == 1 ? c.smithSet : null,
			                    c => c.sortedFirstRankVotes];
			break;
		case "Landau//Plurality":
			myCARS = landauCARS;
			victoryFunctions = [c => c.smithSet.length == 1 ? c.smithSet : null,
			                    c => c.sortedFirstRankVotes];
			break;
		case "IPE":
			victoryFunctions = [c => IPETest(c)];
			break;
		case "RCIPE":
			victoryFunctions = [c => RCIPETest(c)];
			break;
		case "BTR":
			victoryFunctions = [c => BTRTest(c)];
			break;
		case "Smith//Dowdall":
			myCARS = smithCARS;
			victoryFunctions = [c => c.smithSet.length == 1 ? c.smithSet : null,
			                    c => c.sortedDowdallScores];
			break;
		case "Black":
			victoryFunctions = [c => c.smithSet.length == 1 ? c.smithSet : null,
			                    c => c.sortedBordaScores];
			break;
		case "Smith//AntiPlurality":
			myCARS = smithCARS;
			victoryFunctions = [c => c.smithSet.length == 1 ? c.smithSet : null,
			                    c => c.sortedLastRankVotes];
			break;
		case "Condorcet//Hare":
			victoryFunctions = [c => c.smithSet.length == 1 ? c.smithSet : null,
			                    c => HareTest(c)];
			break;
		case "Smith//Hare":
			myCARS = smithCARS;
			victoryFunctions = [c => c.smithSet.length == 1 ? c.smithSet : null,
			                    c => HareTest(c)];
			break;
		case "TidemanAlt":
			myCARS = smithCARS;
			victoryFunctions = [c => c.smithSet.length == 1 ? c.smithSet : null,
			                    c => HareTest(c, true, true)];
			break;
		case "Landau//Hare":
			myCARS = landauCARS;
			victoryFunctions = [c => c.smithSet.length == 1 ? c.smithSet : null,
			                    c => HareTest(c)];
			break;
		case "LandauTidemanAlt":
			myCARS = landauCARS;
			victoryFunctions = [c => c.smithSet.length == 1 ? c.smithSet : null,
			                    c => HareTest(c, true, false, false, true)];
			break;
		case "Benham":
			victoryFunctions = [c => c.smithSet.length == 1 ? c.smithSet : null,
			                    c => HareTest(c, true)];
			break;
		case "Woodall":
			victoryFunctions = [c => c.smithSet.length == 1 ? c.smithSet : null,
			                    c => HareTest(c, false, false, true)];
			break;
		case "Baldwin":
			myCARS = baseCARS;
			victoryFunctions = [c => c.smithSet.length == 1 ? c.smithSet : null,
			                    c => BordaTest(c, true)];
			break;
		case "Smith//Coombs":
			myCARS = smithCARS;
			victoryFunctions = [c => c.smithSet.length == 1 ? c.smithSet : null,
			                    c => CoombsTest(c, true)];
			break;

		case "Smith//RawRange":
			myCARS = smithCARS;
			victoryFunctions = [c => c.smithSet.length == 1 ? c.smithSet : null,
			                    c => c.sortedTotalLinearDistance];
			break;
		case "Smith//Score":
			myCARS = smithCARS;
			victoryFunctions = [c => c.smithSet.length == 1 ? c.smithSet : null,
			                    c => c.sortedTotalNormalizedDistance];
			break;
		case "Smith//ItNormRange":
			myCARS = smithCARS;
			victoryFunctions = [c => c.smithSet.length == 1 ? c.smithSet : null,
			                    c => IterativeNormalizationTest(c, true)];
			break;
		case "Smith//Approval":
			myCARS = smithCARS;
			victoryFunctions = [c => c.smithSet.length == 1 ? c.smithSet : null,
			                    c => c.sortedTotalApprovalScores];
			break;
		case "Smith//Median":
			myCARS = smithCARS;
			victoryFunctions = [c => c.smithSet.length == 1 ? c.smithSet : null,
			                    c => c.sortedMedianScores];
			break;
		case "Smith//321":
			myCARS = smithCARS;
			victoryFunctions = [c => c.smithSet.length == 1 ? c.smithSet : null, c => {
				if (c.cs.length == 1) {return [c.cs, -1];}
				if (c.cs.length == 2) {return [c.sortedFirstRankVotes, -1];}
				let semifinalist1 = c.sortedTotalApprovalScores[0];
				let semifinalist2 = c.sortedTotalApprovalScores[1];
				let semifinalist3 = c.sortedTotalApprovalScores[2];
				let finalist1 = semifinalist1;
				let finalist2 = semifinalist2;
				if        (c.lastRankVotes[semifinalist1] > c.lastRankVotes[semifinalist2] &&
				           c.lastRankVotes[semifinalist1] > c.lastRankVotes[semifinalist3]) {
					finalist1 = semifinalist3;
				} else if (c.lastRankVotes[semifinalist2] > c.lastRankVotes[semifinalist1] &&
				           c.lastRankVotes[semifinalist2] > c.lastRankVotes[semifinalist3]) {
					finalist2 = semifinalist3;
				}
				if (c.results[finalist1] == null) {return finalist2;}
				if (c.results[finalist2] == null) {return finalist1;}
				return (c.results[finalist1][finalist2] > c.results[finalist2][finalist1]) ? [finalist1, finalist2]
				                                                                           : [finalist2, finalist1];
			}];
			break;
		case "Smith//STAR":
			myCARS = smithCARS;
			victoryFunctions = [c => c.smithSet.length == 1 ? c.smithSet : null, c => {
				let runoff1 = c.sortedTotalNormalizedDistance[0];
				let runoff2 = c.sortedTotalNormalizedDistance[1];
				if (c.results[runoff1] == null) {return runoff2;}
				if (c.results[runoff2] == null) {return runoff1;}
				return (c.results[runoff1][runoff2] > c.results[runoff2][runoff1] ||
				        (c.results[runoff1][runoff2] == c.results[runoff2][runoff1] && runoff1 < runoff2)) ?
				            [runoff1, runoff2] : [runoff2, runoff1];
			}];
			break;

		case "Minimax":
			victoryFunctions = [c => c.smithSet.length == 1 ? c.smithSet : null,
			                    c => MinimaxTest(c)];
			break;
		case "RankedPairs":
			myCARS = smithCARS;
			victoryFunctions = [c => c.smithSet.length == 1 ? c.smithSet : null,
			                    c => RankedPairsTest(c)];
			break;
		case "StableVoting":
			myCARS = smithCARS;
			victoryFunctions = [c => c.smithSet.length == 1 ? c.smithSet : null,
			                    c => StableVotingTest(c)];
			break;
		case "Schulze":
			myCARS = smithCARS;
			victoryFunctions = [c => c.smithSet.length == 1 ? c.smithSet : null,
			                    c => SchulzeTest(c)];
			break;
		case "RangeMinimax":
			myCARS = smithCARS;
			victoryFunctions = [c => c.smithSet.length == 1 ? c.smithSet : null,
			                    c => NormRangeMinimaxTest(c)];
			break;
			
		default:
		}
		
		initElimRecordData();
		let isElimMethod = isMethodIDElimination(methodID);
		isCurrentlyRecordingElimData = isElimMethod;
		
		if (isMethodIDPartisan(methodID) && leftCARS != null && rightCARS != null) {
			let myLeftCARS = isMethodIDLowTurnout(methodID) ? ltLeftCARS : leftCARS;
			let myRightCARS = isMethodIDLowTurnout(methodID) ? ltRightCARS : rightCARS;
			let winnerLeft = getWinners(myLeftCARS, victoryFunctions)[0];
			isCurrentlyRecordingElimData = false;
			let winnerRight = getWinners(myRightCARS, victoryFunctions)[0];
			let isWinnerLeft = baseCARS.results[winnerLeft][winnerRight] > baseCARS.results[winnerRight][winnerLeft];
			let winnerCARS;
			let loserCARS;
			if (isWinnerLeft) {
				this.naturalWinner = winnerLeft;
				this.runnerUp = winnerRight;
				winnerCARS = myLeftCARS;
				loserCARS = myRightCARS;
			} else {
				this.naturalWinner = winnerRight;
				this.runnerUp = winnerLeft;
				winnerCARS = myRightCARS;
				loserCARS = myLeftCARS;
			}
			if (!isDetailed) {return;}
			if (myCARS.cs.length >= 3 && isElimMethod) {this.elimData = currentElimRecordData; this.elimUMFData = currentElimUMFData;
				                                        this.elimDMFData = currentElimDMFData;}
			
			
			//test intra-party strategies for the winner's side, including pulling from the enemy side
			for (let c = 0; c < winnerCARS.cs.length; c++) {
				let can = winnerCARS.cs[c];
				if (can == this.naturalWinner) {continue;}
				if (winnerCARS.results[can][this.naturalWinner] > winnerCARS.results[this.naturalWinner][can]) {
					this.strategicDominantWinners.push(can);
					continue;
				}
				if (baseCARS.results[can][this.naturalWinner] > baseCARS.results[this.naturalWinner][can]) {
					this.strategicCrossoverWinners.push(can);
					continue;
				}
			}
			
			//now we test the loser's side's ability to conduct a strategy
			for (let c1 = 0; c1 < loserCARS.cs.length; c1++) {
				let attacker = loserCARS.cs[c1];
				//First, does this attacker just... win? (Are they the stronger candidate being overlooked by their side?)
				if (baseCARS.results[attacker][this.naturalWinner] > baseCARS.results[this.naturalWinner][attacker]) {
					this.strategicDominantWinners.push(attacker);
					
					//record UMF
					let delta = 0;
					if (methodStr == "PartyPlurality" || methodStr == "LT-PartyPlurality") {
						delta = loserCARS.firstRankVotes[this.runnerUp] - loserCARS.firstRankVotes[attacker];
					} else if (methodStr == "PartyHare" || methodStr == "LT-PartyHare") {
						//estimate
						delta = loserCARS.firstRankVotes[this.runnerUp] - loserCARS.firstRankVotes[attacker];
					} else if (methodStr == "PartyApproval" || methodStr == "LT-PartyApproval") {
						delta = -(loserCARS.totalApprovalScores[this.runnerUp] - loserCARS.totalApprovalScores[attacker]);
					} else if (methodStr == "PartyMinimax" || methodStr == "LT-PartyMinimax") {
						delta = loserCARS.results[this.runnerUp][attacker] - loserCARS.results[attacker][this.runnerUp];
					}
					if (this.elimUMFData == null) {this.elimUMFData = {};}
					if (!(this.naturalWinner in this.elimUMFData)) {this.elimUMFData[this.naturalWinner] = {};}
					if (!(this.runnerUp in this.elimUMFData[this.naturalWinner])) {this.elimUMFData[this.naturalWinner][this.runnerUp] = {};}
					this.elimUMFData[this.naturalWinner][this.runnerUp][attacker] = [delta, 9999];
					
					continue;
				}
				//Now let's see if they could arrange a win by picking a more favorable opponent
				for (let c2 = 0; c2 < winnerCARS.cs.length; c2++) {
					let patsy = winnerCARS.cs[c2];
					if (patsy == this.naturalWinner) {continue;}
					if (baseCARS.results[patsy][attacker] > baseCARS.results[attacker][patsy]) {continue;} //oops, we'd lose against this guy, nevermind
					
					//So we've identified a patsy opponent they COULD beat--but can they meddle enough to make the patsy win the primary?					
					//We are assuming a cap of 50% of ideologically agreeable voters being able to meddle
					let totalAmmo = 0;				
					for (let i = 0; i < voter_data.length; i++) {
						if (winnerCARS.lowTurnout && voter_data[i][5] == 0) { continue; }
						if (voter_data[i][2][this.naturalWinner] > voter_data[i][2][attacker]) {
							totalAmmo++;
						}
					}
					totalAmmo = Math.floor(totalAmmo/2);
					
					let totalAmmoRequired = 9999;
					if (methodStr == "PartyPlurality" || methodStr == "LT-PartyPlurality") {
						totalAmmoRequired = winnerCARS.firstRankVotes[this.naturalWinner] - winnerCARS.firstRankVotes[patsy];
					} else if (methodStr == "PartyHare" || methodStr == "LT-PartyHare") {
						//estimate
						totalAmmoRequired = winnerCARS.firstRankVotes[this.naturalWinner] - winnerCARS.firstRankVotes[patsy];
					} else if (methodStr == "PartyApproval" || methodStr == "LT-PartyApproval") {
						totalAmmoRequired = winnerCARS.totalApprovalScores[patsy] - winnerCARS.totalApprovalScores[this.naturalWinner];
					} else if (methodStr == "PartyMinimax" || methodStr == "LT-PartyMinimax") {
						totalAmmoRequired = winnerCARS.results[this.naturalWinner][patsy] - winnerCARS.results[patsy][this.naturalWinner];
					}
					if (totalAmmo > totalAmmoRequired) {
						if (attacker in this.strategicAttackingPairs == false) { this.strategicAttackingPairs[attacker] = []; }
						this.strategicAttackingPairs[attacker].push(patsy);
						
						if (this.elimDMFData == null) {this.elimDMFData = {};}
						if (!(this.naturalWinner in this.elimDMFData)) {this.elimDMFData[this.naturalWinner] = {};}
						if (!(patsy in this.elimDMFData[this.naturalWinner])) {this.elimDMFData[this.naturalWinner][patsy] = {};}
						this.elimDMFData[this.naturalWinner][patsy][attacker] = [totalAmmoRequired, totalAmmo];
					}
				}				
			}
			this.wastedVotes = 0;
			
		} else {
			let winners = getWinners(myCARS, victoryFunctions);
			isCurrentlyRecordingElimData = false;
			this.naturalWinner = winners[0];
			this.runnerUp = winners.length > 1 ? winners[1]: -1;
			if (!isDetailed) {return;}
			if (this.runnerUp == -1 && myCARS.cs.length > 1) {
				if (!(this.naturalWinner in runnerUpCARSs)) {
					let newCS = myCARS.cs.filter(c => c !== this.naturalWinner);
					runnerUpCARSs[this.naturalWinner] = new CARS(newCS, false, myCARS, "all");
				}
				this.runnerUp = getWinners(runnerUpCARSs[this.naturalWinner], victoryFunctions)[0];
			}
			if (myCARS.cs.length >= 3) {
				if (isElimMethod) {this.elimData = currentElimRecordData; this.elimUMFData = currentElimUMFData;
								   this.elimDMFData = currentElimDMFData;}
				else if (methodList[methodID] == "Top2Runoff") {
					initElimRecordData();
					let runnerUp = this.naturalWinner == myCARS.sortedFirstRankVotes[0] ?
														 myCARS.sortedFirstRankVotes[1] : myCARS.sortedFirstRankVotes[0];
					Top2RunoffMonoticityTest(myCARS, this.naturalWinner, runnerUp, myCARS.sortedFirstRankVotes[2]);
					this.elimUMFData = currentElimUMFData;
					this.elimDMFData = currentElimDMFData;
				}
			}
			computeAllStrategicCARSvsTarget(this.naturalWinner);
			for (let testc = 0; testc < candidate_data.length; testc++) {
				if (testc == this.naturalWinner) {continue;}
				if (candidate_data[testc][5]) {continue;} //isHidden
				let sCARS = strategicCARSs[testc + "/" + this.naturalWinner];
				
				//first do special anti-plurality testing
				if (methodStr == "AntiPlurality" || (methodStr == "Smith//AntiPlurality" && sCARS.smithSet.includes(testc))) {
					let totalAmmoRequired = sCARS.lastRankVotes[testc] * (sCARS.cs.length-1);
					let totalAmmo = 0;
					for (let i = 0; i < voter_data.length; i++) {
						if (voter_data[i][2][this.naturalWinner] > voter_data[i][2][testc]) {
							totalAmmo++;
						}
					}
					if (totalAmmo > totalAmmoRequired) {
						this.strategicAntiPluralityWinners.push(testc);
					}
				} else if (methodStr == "Coombs" || (methodStr == "Smith//Coombs" && sCARS.smithSet.includes(testc))) {
					let totalAmmoRequired = 0;
					for (let c1 = 0; c1 < sCARS.cs.length; c1++) {
						let can = sCARS.cs[c1];
						if (can == this.naturalWinner) { continue; }
						if (sCARS.lastRankVotes[can] >= totalAmmoRequired) {
							totalAmmoRequired = sCARS.lastRankVotes[can] + 1;
						}
					}
					let totalAmmo = 0;
					for (let i = 0; i < voter_data.length; i++) {
						if (voter_data[i][2][this.naturalWinner] > voter_data[i][2][testc]) {
							totalAmmo++;
						}
					}
					if (totalAmmo > totalAmmoRequired) {
						this.strategicAntiPluralityWinners.push(testc);
					}
				}
				
				let x = getWinners(sCARS, victoryFunctions);
				if (x == null) console.log(methodList[methodID]);
				let alt = x[0];
				let patsy = -1;
				if      (alt == null)               {continue;} //oops
				else if (alt == this.naturalWinner) {continue;} //whelp
				else  {
					let isWithdrawWorks = false;
					if ((isMethodIDCondorcet(methodID) || methodList[methodID] == "STAR3") && alt == testc) {
						//star 3 can have local cycles too
						let otherCandidatesOpposed = [];
						for (let c1 = 0; c1 < candidate_data.length; c1++) {
							if (c1 == this.naturalWinner || c1 == testc) {continue;}
							if (candidate_data[c1][2][this.naturalWinner] < candidate_data[c1][2][testc]) {
								otherCandidatesOpposed.push(c1);
							}
						}
						if (otherCandidatesOpposed.length > 0) {
							let newCS = sCARS.cs.filter(c => !otherCandidatesOpposed.includes(c));
							let analysisFilter = methodList[methodID] == "Smith//321" ? "all" :
												 methodList[methodID] == "Smith//Median" ? "median" :
												 isMethodIDCardinal(methodID) ? "cardinal" :
												 methodList[methodID] == "StableVote" ? null : "ordinal";
							let wsCARS = new CARS(newCS, false, sCARS, analysisFilter, sCARS.attacker, sCARS.target); //TODO: optimize
							if (getWinners(wsCARS, victoryFunctions) == null) console.log(methodList[methodID], analysisFilter, wsCARS.medianScores);
							let wAlt = getWinners(wsCARS, victoryFunctions)[0];
							for (let c1 = 0; c1 < candidate_data.length; c1++) {
								if (c1 == this.naturalWinner || c1 == testc || !sCARS.smithSet.includes(c1)) {continue;}
								patsy = c1; {break;}
							}
							isWithdrawWorks = this.naturalWinner == wAlt;
						}
					}
					
					sCARS = strategicCARSs[testc + "/" + this.naturalWinner + "!"]; //they will fight back...
					let alt2 = getWinners(sCARS, victoryFunctions)[0];
					
					if (alt == testc) { //we won!  but how strong was our victory?  3 possibilities:
						if (isWithdrawWorks)  { this.strategicWithdrawVulnerableWinners[alt] = patsy; }
						else if (alt == alt2) { this.strategicDominantWinners.push(alt); }
						else                  { this.strategicReversibleWinners.push(alt); }
					} else {
						let prefer = 0;
						let total = 0;
						for (let i = 0; i < voter_data.length; i++) {
							if (voter_data[i][2][testc] < voter_data[i][2][this.naturalWinner]) {
								total++;
								if (voter_data[i][2][alt] < voter_data[i][2][this.naturalWinner]) {
									prefer++;
								}
							}
						}
						this.strategicBackfires.push([testc, alt, prefer/total]);
					}
					if (alt2 != alt && alt2 != this.naturalWinner) { this.strategicCounterstrategyBackfires.push([testc, alt2]); }
				}
			}
			
			//simple clone testing
			if (myCARS.cs.length > 1) {
				if (methodStr == "ApprovalRunoff") {
					if (baseCARS.totalApprovalScores[this.runnerUp] < baseCARS.totalApprovalScores[this.naturalWinner]) {
						this.strategicCloneWinners.push(this.runnerUp);
					}
				} else if (methodStr == "STAR") {
					if (baseCARS.totalNormalizedDistance[this.runnerUp] < baseCARS.totalNormalizedDistance[this.naturalWinner]) {
						this.strategicCloneWinners.push(this.runnerUp);
					}
				} else if (methodStr == "STAR3") {
					if (baseCARS.sortedTotalNormalizedDistance[2] == this.naturalWinner) {
						this.strategicCloneWinners.push(baseCARS.sortedTotalNormalizedDistance[0]);
						this.strategicCloneWinners.push(baseCARS.sortedTotalNormalizedDistance[1]);
					}
				} else if (methodStr == "Smith//STAR") {
					if (baseCARS.totalNormalizedDistance[this.runnerUp] < baseCARS.totalNormalizedDistance[this.naturalWinner] && strategicCARSs[this.runnerUp + "/" + this.naturalWinner].smithSet.includes(this.runnerUp)) {
						this.strategicCloneWinners.push(this.runnerUp);
					}
				} 
			}
			
			//wasted votes
			this.wastedVotes = 0;
			if (myCARS.cs.length > 1) {
				if (methodStr == "Plurality") {
					for (let i = 0; i < voter_data.length; i++) {
						if (voter_data[i][2][this.runnerUp] > voter_data[i][2][this.naturalWinner]) {continue;}
						if (voter_data[i][3][0] != this.runnerUp) { this.wastedVotes++; }
					}
				} else if (methodStr == "RawRange") {
					for (let i = 0; i < voter_data.length; i++) {
						if (voter_data[i][2][this.runnerUp] > voter_data[i][2][this.naturalWinner]) {continue;}
						let n1 = voter_data[i][2][this.naturalWinner];
						let n2 = voter_data[i][2][this.runnerUp];
						let d = n1 - n2;
						if (d < MAX_RANGE_DISTANCE) { this.wastedVotes += (MAX_RANGE_DISTANCE - d) / (MAX_RANGE_DISTANCE); }
					}
				} else if (methodStr == "NormalRange") {
					for (let i = 0; i < voter_data.length; i++) {
						if (voter_data[i][2][this.runnerUp] > voter_data[i][2][this.naturalWinner]) {continue;}
						let n1 = myCARS.dispo_normalized_voter_data[i][this.naturalWinner];
						let n2 = myCARS.dispo_normalized_voter_data[i][this.runnerUp];
						//this.wastedVotes += 1 - (n1 - n2);
						if (n1 < 1 || n2 > 0) {
							this.wastedVotes++;
						}
					}
				} else if (methodStr == "Approval") {
					for (let i = 0; i < voter_data.length; i++) {
						if (voter_data[i][2][this.runnerUp] > voter_data[i][2][this.naturalWinner]) {continue;}
						let n1 = myCARS.dispo_normalized_voter_data[i][this.naturalWinner];
						let n2 = myCARS.dispo_normalized_voter_data[i][this.runnerUp];
						if ((n1 > 0.5 && n2 > 0.5) || (n1 <= 0.5 && n2 <= 0.5)) { this.wastedVotes++; }
					}
				} else if (methodStr == "V321") {
					for (let i = 0; i < voter_data.length; i++) {
						if (voter_data[i][2][this.runnerUp] > voter_data[i][2][this.naturalWinner]) {continue;}
						if (voter_data[i][3][candidate_data.length-1] == this.naturalWinner ||
							voter_data[i][3][candidate_data.length-1] == this.runnerUp) {continue;}
						let n1 = myCARS.dispo_normalized_voter_data[i][this.naturalWinner];
						let n2 = myCARS.dispo_normalized_voter_data[i][this.runnerUp];
						if ((n1 > 0.5 && n2 > 0.5) || (n1 <= 0.5 && n2 <= 0.5)) { this.wastedVotes++; }
					}
				} else if (methodStr == "Median") {
					for (let i = 0; i < voter_data.length; i++) {
						if (voter_data[i][2][this.runnerUp] > voter_data[i][2][this.naturalWinner]) {continue;}
						let n1 = myCARS.dispo_normalized_voter_data[i][this.naturalWinner];
						let n2 = myCARS.dispo_normalized_voter_data[i][this.runnerUp];
						/*if (n1 < myCARS.medianScores[this.naturalWinner]) {
							this.wastedVotes += myCARS.medianScores[this.naturalWinner] - n1;
						} if (n2 > myCARS.medianScores[this.runnerUp]) {
							this.wastedVotes += n2 - myCARS.medianScores[this.runnerUp];
						} */
						if (n1 < myCARS.medianScores[this.naturalWinner] || n2 > myCARS.medianScores[this.runnerUp]) {
							this.wastedVotes++;
						}
					}
				}
			}
		}
	}
}

function getWinners(myCARS, victoryFunctions) {
	if (victoryFunctions == null) {return null;}
	//console.log(victoryFunctions + " " + myCARS.cs);
	for (let i = 0; i < victoryFunctions.length; i++) {
		let winners = victoryFunctions[i](myCARS);
		if (winners != null && winners[0] != null) {return winners;}
	}
	return null;
}

function createBaseCARS() {
	baseCARS = new CARS();
}

function analyzeBaseCARS() {
	baseCARS.analyzeOrdinal();
	baseCARS.analyzeCardinal();
	baseCARS.analyzeMedian();
	if (baseCARS.smithSet.length == 1 || baseCARS.cs.length == baseCARS.smithSet.length) {
		smithCARS = baseCARS;
	} else {
		smithCARS = new CARS(baseCARS.smithSet, false, baseCARS, "all");
	}
	if (smithCARS.landauSet.length == smithCARS.smithSet.length) {
		landauCARS = smithCARS;
	} else {
		landauCARS = new CARS(smithCARS.landauSet, false, smithCARS, "ordinal");
	}
	strategicCARSs = {};
	runnerUpCARSs = {};
}
function createPartisanCARS() {
	let candidatesLeft = [];
	let candidatesRight = [];
	for (let c = 0; c < candidate_data.length; c++) {
		let can = candidate_data[c];
		if (can[5]) { continue; } //hidden
		if (can[0] > 0) { candidatesRight.push(c); }
		else            { candidatesLeft.push(c); }
	}
	if (candidatesLeft.length == 0 || candidatesRight.length == 0)
	{
		leftCARS = null;
		rightCARS = null;
		ltLeftCARS = null;
		ltRightCARS = null;
		return;
	}
	leftCARS    = new CARS(candidatesLeft,  false, null, "all", null, null, false, -1);
	rightCARS   = new CARS(candidatesRight, false, null, "all", null, null, false,  1);
	ltLeftCARS  = new CARS(candidatesLeft,  false, null, "all", null, null, false, -1, true);
	ltRightCARS = new CARS(candidatesRight, false, null, "all", null, null, false,  1, true);
}

function analyzePartisanCARS() {
	//currently auto-analyzes, see 3rd param set to "all" above
}
function computeStrategicCARS(attacker, target, counterStrategy = false) {
	let s = attacker + "/" + target + (counterStrategy ? "!" : "");
	if (s in strategicCARSs) { return strategicCARSs[s]; }
	let next = new CARS(null, false, null, "all", attacker, target, counterStrategy);
	next.dispo_normalized_voter_data = null; //we don't need all this raw data anymore
	strategicCARSs[s] = next;
	return next;
}
function computeAllStrategicCARSvsTarget(target) {
	for (let c1 = 0; c1 < candidate_data.length; c1++) {
		if (c1 == target) { continue; }
		if (candidate_data[c1][5]) { continue; } //isHidden
		computeStrategicCARS(c1, target, false);
		computeStrategicCARS(c1, target, true);
	}
	computeStrategicCARS(-1, target, false); //mass bury
}
function computeAllMRDs(isCardinalOnly = false, cacheKey = null) {
	for (let m = 0; m < methodList.length; m++) {
		if (isCardinalOnly && !(isMethodIDCardinal(m))) {continue;}
		MRDs[m] = new MRD(m);
		postMessage({kind: "MRD", cacheKey: cacheKey, data: MRDs[m]});
	}
}

class Trial {
	constructor(voterCategory, voterCount, candidateCount, numberOfClusterIterations,
	            lowerDispoBound, upperDispoBound) {
		this.vCat = voterCategory; 
		this.vCount = voterCount;
		this.cCount = candidateCount;
		this.clusters = numberOfClusterIterations;
		
		voter_data = generateVoterData(voterCategory, voterCount);
		candidate_data = [];
		candidate_data = generateCandidateData("Uniform", candidateCount, voterCategory,
		                                       candidate_data, voter_data, 0,
		                                       lowerDispoBound, upperDispoBound);
		if (numberOfClusterIterations > 0) {
			candidate_data = generateCandidateData("Cluster", candidateCount, voterCategory,
		                                           candidate_data, voter_data, numberOfClusterIterations,
		                                           lowerDispoBound, upperDispoBound);
		} else if (numberOfClusterIterations < 0) {
			candidate_data = generateCandidateData("Party-Cluster", candidateCount, voterCategory,
		                                           candidate_data, voter_data, -numberOfClusterIterations,
		                                           lowerDispoBound, upperDispoBound);
		}
		measureVoterDistancesAll(voter_data, candidate_data);
		calculateVoterRanks(voter_data);
		
		createBaseCARS();
		analyzeBaseCARS();
		createPartisanCARS();
		analyzePartisanCARS();
		this.conWin = baseCARS.condorcetWinner;
		this.conLose = baseCARS.condorcetLoser;
		this.majority = (baseCARS.firstRankVotes[baseCARS.sortedWins[0]] > voterCount / 2) ?
		                baseCARS.condorcetWinner :
		                null;
		this.smithSet = baseCARS.smithSet;
		this.util3Win = baseCARS.utilityWinners[3];
		this.util5Win = baseCARS.utilityWinners[5];
		this.util7Win = baseCARS.utilityWinners[7];
		this.distances = new Array(candidate_data.length);
		for (let c = 0; c < candidate_data.length; c++) {
			let dx = candidate_data[c][0];
			let dy = candidate_data[c][1];
			this.distances[c] = Math.sqrt(dx * dx + dy * dy);
		}
		this.dispos = new Array(candidate_data.length);
		for (let c = 0; c < candidate_data.length; c++) { this.dispos[c] = candidate_data[c][4]; }
		
		this.MRDs = {};
		for (let m = 0; m < methodList.length; m++) { this.MRDs[m] = new MRD(m); }
		
		return this;
	}
}

class HeatmapTrial {
	constructor(v_d, c_d, newX, newY, newDispo, heatmapIndex) {
		this.heatmapIndex = heatmapIndex;
		voter_data = [...v_d];
		candidate_data = [...c_d];
		candidate_data.push([newX, newY, [], candidate_data.length, newDispo, false, 0]);
		measureVoterDistance(voter_data, candidate_data, candidate_data.length - 1);
		calculateVoterRanks(voter_data);
		
		createBaseCARS();
		analyzeBaseCARS();
		createPartisanCARS();
		analyzePartisanCARS();
		this.conWin = baseCARS.condorcetWinner;
		this.conLose = baseCARS.condorcetLoser;
		this.majority = (baseCARS.firstRankVotes[baseCARS.sortedWins[0]] > voter_data.length / 2) ?
		                baseCARS.condorcetWinner :
		                null;
		this.smithSet = baseCARS.smithSet;
		
		this.MRDs = {};
		for (let m = 0; m < methodList.length; m++) { this.MRDs[m] = new MRD(m, false); }
		
		return this;
	}
}

let lastUpdateTime = 0;
function runTrials(simCount, voterCategory, voterCount, candidateCount, numberOfClusterIterations,
	               lowerDispoBound, upperDispoBound,
	               batchUpdatePeriod, batchUpdateOffset) {
	reseed();
	lastUpdateTime = new Date().getTime();
	let pendingResultsQueue = [];
	for (let i = 0; i < simCount; i++) {
		let trial = new Trial(voterCategory, voterCount, candidateCount, numberOfClusterIterations,
		                      lowerDispoBound, upperDispoBound);
		pendingResultsQueue.push(trial);
		
		let now = new Date().getTime();
		if (now + batchUpdateOffset > lastUpdateTime + batchUpdatePeriod) {
			self.postMessage({pendingResultsQueue});
			pendingResultsQueue = [];
			lastUpdateTime = now;
		}
	}
	if (pendingResultsQueue.length > 0) {
		self.postMessage({pendingResultsQueue});
	}
}

function runHeatmapTrials(simCount, heatmapIndexOffset, rez, marginX, marginY,
                          voter_data, candidate_data, newDispo,
	                      batchUpdatePeriod, batchUpdateOffset) {
	lastUpdateTime = new Date().getTime();
	let pendingResultsQueue = [];
	for (let i = 0; i < simCount; i++) {
		let index = i + heatmapIndexOffset;
		let coords = heatmapIndex_to_coords(index, rez, marginX, marginY);
		let trial = new HeatmapTrial(voter_data, candidate_data, coords[0], coords[1], newDispo, index);
		pendingResultsQueue.push(trial);
		
		let now = new Date().getTime();
		if (now + batchUpdateOffset > lastUpdateTime + batchUpdatePeriod) {
			self.postMessage({pendingResultsQueue});
			pendingResultsQueue = [];
			lastUpdateTime = now;
		}
	}
	if (pendingResultsQueue.length > 0) {
		self.postMessage({pendingResultsQueue});
	}
}

function heatmapIndex_to_coords(index, rez, marginX, marginY)
{
	let y = Math.floor(index / rez);
	let x = index % rez;
	return [ x/(rez-1)*(10-2*marginX)-5+marginX,
			-y/(rez-1)*(10-2*marginY)+5-marginY];
}