/*jshint esversion: 11 */

import {randomLcg} from "https://cdn.skypack.dev/d3-random@3";
import {randomInt} from "https://cdn.skypack.dev/d3-random@3";
import {randomUniform} from "https://cdn.skypack.dev/d3-random@3";
import {randomNormal} from "https://cdn.skypack.dev/d3-random@3";

export const PERFECTION_PENALTY = 0.05; //normalization
export const MAX_CANDIDATES = 6;
const CANDIDATE_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"];

export function label(i) { return i == -1 ? 'X' : CANDIDATE_LABELS[i]; }

export function list2labels(list) {
	let s = "";
	for (let i = 0; i < list.length; i++) {
		s += label(list[i]) + ((i == list.length - 1) ? "" : ", ");
	}
	return s;
}
export function list2labelPairs(list) {
	let s = "";
	for (let i = 0; i < list.length; i++) {
		s += label(list[i][0]) + " => " + label(list[i][1]) + ((i == list.length - 1) ? "" : ", ");
	}
	return s;
}
export function rankArray2string(list) {
	let s = "";
	for (let i = 0; i < list.length; i++) {
		if (list[i] == ',') {s += " > ";}
		else {s += label(parseInt(list[i])); }
	}
	return s;
}

export const methodList = [
                           "AntiPlurality",
                           "Plurality",

                           "PartyPlurality",
                           "PartyHare",
                           "PartyMinimax",
                           "PartyApproval",
                           "LT-PartyPlurality",
                           "LT-PartyHare",
                           "LT-PartyMinimax",
                           "LT-PartyApproval",

                           "Top2Runoff",
                           "Hare (IRV)",
                           "Contingency",
                           "Coombs",

                           "Borda",
                           "Dowdall",

                           "RawRange",
                           "NormalRange",
                           "Approval",
                           "Median",
                           "V321",
                           "ApprovalRunoff",
                           "STAR",
                           "STAR3",
                           "ItNormRange",

                           "RCIPE",
                           "IPE",
                           "BTR",
                           "Condorcet//Plurality",
                           "Smith//Plurality",
                           "Landau//Plurality",
                           "Smith//AntiPlurality",

                           "Black",
                           "Smith//Dowdall",

                           "Baldwin",

                           "Condorcet//Hare",
                           "Woodall",
                           "Smith//Hare",
                           "Benham",
                           "TidemanAlt",
                           "Landau//Hare",
                           "LandauTidemanAlt",

                           "Smith//Coombs",

                           "Smith//Score",
                           "Smith//Approval",
                           "Smith//Median",
                           "Smith//321",
                           "Smith//STAR",
                           "Smith//ItNormRange",

                           "Minimax",
                           "Schulze",
                           "RankedPairs",
                           "StableVoting"];

export const methodListFanCorrelations = [
                           "Plurality",

                           "PartyPlurality",
                           "PartyHare",
                           "PartyMinimax",
                           "PartyApproval",

                           "LT-PartyApproval",
                           "LT-PartyMinimax",
                           "LT-PartyHare",
                           "LT-PartyPlurality",

                           "Top2Runoff",
                           "Hare (IRV)",
                           "Contingency",
                           "Dowdall",
                           "Median",

                           "RawRange",
                           "NormalRange",
                           "Approval",
                           "ApprovalRunoff",
                           "STAR",
                           "Smith//STAR",
                           "ItNormRange",
                           "Smith//ItNormRange",
                           "STAR3",

                           "Minimax",
                           "Schulze",
                           "StableVoting",
                           "RankedPairs",
                           "RCIPE",
                           "IPE",

                           "Black",
                           "Smith//Dowdall",

                           "Smith//RawRange",
                           "Smith//Score",
                           "Smith//Approval",
                           "Smith//Median",

                           "Condorcet//Plurality",
                           "Smith//Plurality",
                           "Landau//Plurality",
                           "BTR",
                           "Condorcet//Hare",
                           "Woodall",
                           "Smith//Hare",
                           "TidemanAlt",
                           "Landau//Hare",
                           "LandauTidemanAlt",
                           "Benham",
                           "Baldwin",

                           "Smith//Coombs",
                           "Smith//321",
                           "Smith//AntiPlurality",

                           "Borda",

                           "Coombs",
                           "V321",
                           "AntiPlurality"
                           ];
const partisanMethods = ["PartyPlurality",
                         "PartyHare",
                         "PartyApproval",
                         "PartyMinimax",
                         "LT-PartyPlurality",
                         "LT-PartyHare",
                         "LT-PartyApproval",
                         "LT-PartyMinimax"];
const lowTurnoutMethods = ["LT-PartyPlurality",
                           "LT-PartyHare",
                           "LT-PartyApproval",
                           "LT-PartyMinimax"];
const cardinalMethods = ["PartyApproval",
                         "LT-PartyApproval",
                         "RawRange",
                         "NormalRange",
                         "ItNormRange",
                         "Approval",
                         "Median",
                         "V321",
                         "ApprovalRunoff",
                         "STAR",
                         "STAR3",
                         "Smith//RawRange",
                         "Smith//Score",
                         "Smith//ItNormRange",
                         "Smith//Approval",
                         "Smith//Median",
                         "Smith//321",
                         "Smith//STAR",
                         "Smith//RangeMinimax"];
const eliminationMethods = ["PartyHare",
                            "LT-PartyHare",
                            "Hare (IRV)",
                            "Contingency",
                            "Coombs",
                            "ItNormRange",
                            "RCIPE",
                            "IPE",
                            "BTR",
                            "Condorcet//Hare",
                            "Smith//Hare",
                            "TidemanAlt",
                           "Landau//Hare",
                           "LandauTidemanAlt",
                            "Benham",
                            "Woodall",
                            "Baldwin",
                            "Smith//Coombs",
                            "Smith//ItNormRange"];
const condorcetMethods =    ["BTR",
                           "Condorcet//Plurality",
                           "Smith//Plurality",
                           "Landau//Plurality",
                           "Smith//AntiPlurality",
                           "Smith//Dowdall",
                           "Black",
                           "Baldwin",

                           "Condorcet//Hare",
                           "Woodall",
                           "Smith//Hare",
                           "Benham",
                           "TidemanAlt",
                           "Landau//Hare",
                           "LandauTidemanAlt",

                           "Smith//Coombs",

                           "Smith//RawRange",
                           "Smith//Score",
                           "Smith//Approval",
                           "Smith//Median",
                           "Smith//321",
                           "Smith//STAR",
                           "Smith//ItNormRange",

                           "Minimax",
                           "Schulze",
                           "RankedPairs",
                           "StableVoting"];

export const expandDict = { "PartyPlurality": ["PartyHare", "PartyMinimax", "PartyApproval", "LT-PartyPlurality", "LT-PartyHare", "LT-PartyMinimax", "LT-PartyApproval",],
                            "Borda": ["Dowdall"],
                            "STAR": ["STAR3",],
                            "Condorcet//Plurality": ["Smith//Plurality", "Smith//AntiPlurality",],
                            "Black": ["Smith//Dowdall",],
                            "Condorcet//Hare": ["Woodall", "Smith//Hare", "Benham", "TidemanAlt", "Landau//Hare", "LandauTidemanAlt","Smith//Coombs", "IPE", "RCIPE"],
                            "Smith//Score": ["Smith//Approval", "Smith//Median", "Smith//321", "Smith//STAR", "Smith//ItNormRange",],
                            "Minimax": ["Schulze", "RankedPairs", "StableVoting"], }

export function isMethodIDPartisan(id)    { return partisanMethods.includes(methodList[id]);}
export function isMethodIDLowTurnout(id)  { return lowTurnoutMethods.includes(methodList[id]);}
export function isMethodIDCardinal(id)    { return cardinalMethods.includes(methodList[id]);}
export function isMethodIDElimination(id) { return eliminationMethods.includes(methodList[id]);}
export function isMethodIDCondorcet(id)   { return condorcetMethods.includes(methodList[id]);}

let currentSeed;
let source;
let myRandomBasic;
let myRandomUniform;
let myRandomNormal;

export function reseed() {	
	currentSeed = Math.random();
	initRandom();
}
export function loadSeed(newSeed) {
	currentSeed = newSeed;
	initRandom();
}
export function getSeedString() {
	return currentSeed.toString();
}
function initRandom()
{
	source = new randomLcg(currentSeed);
	myRandomBasic = randomUniform.source(source)();
	myRandomUniform = randomUniform.source(source)(-1,1);
	myRandomNormal = randomNormal.source(source)();
}


export function generateVoterData(category, num) {
	let voter_data;
	// voter_data = [xPos, yPos, [candidateDistances], [candidateRanks], voterIndex, isLowTurnoutElgible]
	let array = new Array(num);
	array = Array.from(array.keys());
	let cx = myRandomUniform()/5;
	let cy = myRandomUniform()/5;
	let lowTurnoutTaper = 1;
	switch (category) {
		case "Normal":
			voter_data = Object.assign(array.map(x => [cx + myRandomNormal(), cy + myRandomNormal(), [], [], x, 0]));
			break;
		case "One":
			voter_data = Object.assign(array.map(x => [(cx + myRandomNormal())*1.25, (cy + myRandomNormal())/5, [], [], x, 0]));
			lowTurnoutTaper = 3;
			break;
		case "Polarized":
			let skew = myRandomUniform() / 10;
			voter_data = Object.assign(array.map(x => [(cx + myRandomNormal())/1.5 + ((myRandomNormal() > skew) ? 2 : -2),
			                                           (cy + myRandomNormal())/5, [], [], x, 0]));
			lowTurnoutTaper = 5;
			break;
		case "Clustered":
			let clusters = [];
			for (let i = 0; i < 5; i++) {
				clusters.push([myRandomUniform()*1.5, myRandomUniform()*1.5]);
			}
			voter_data = Object.assign(array.map(x => { let myCluster = clusters[Math.floor(myRandomBasic()*5)];
			                                            return [cx + myRandomNormal()/2 + myCluster[0],
			                                                    cy + myRandomNormal()/2 + myCluster[1], [], [], x, 0]; }));
			break;
		case "Fan":
			let angles = [0,2.1,4.2];
			let oneRandom = myRandomBasic();
			for (let i = 0; i < 3; i++) {
				angles[i] += myRandomBasic()*0.3 + oneRandom;
			}
			voter_data = Object.assign(array.map(x => { let myAngle = angles[Math.floor(myRandomBasic()*2.5)];
			                                            let v1 = [Math.cos(myAngle), Math.sin(myAngle)];
			                                            let v2 = [-Math.sin(myAngle), Math.cos(myAngle)];
			                                            let myR = myRandomNormal() * 0.8 + 2.2; let myN = myRandomNormal()/3;
			                                            return [cx + v1[0]*myR+v2[0]*myN, cy + v1[1]*myR+v2[1]*myN,
			                                                    [], [], x, 0]; }));
			break;
		default:
			break;
	}
	for (let i = 0; i < voter_data.length; i++) {
		voter_data[i][5] = Math.abs(voter_data[i][0]) - lowTurnoutTaper*Math.abs(voter_data[i][1]) > 0.1 ? 1 : 0;
	}
	return voter_data;
}
const K_MEANS_ITERATIONS = 1;
export function generateCandidateData(category, candidateCount, currentElectorateGenCategory, candidate_data, voter_data, clusterIterationCount = K_MEANS_ITERATIONS, lowerDispoBound = 4, upperDispoBound = 6) {
	let array = new Array(candidateCount);
	array = Array.from(array.keys());
	let xRange = 2;
	let yRange = 2;
	if      (currentElectorateGenCategory == "One")       {xRange *= 1.25; yRange /= 5;}
	else if (currentElectorateGenCategory == "Polarized") {xRange *= 1.50; yRange /= 5;}	
	let myRandomDispo = randomInt.source(source)(lowerDispoBound,upperDispoBound+1);
	switch (category) {
		case "Uniform":
			candidate_data = Object.assign(array.map(i => [myRandomUniform() * xRange,
			                                               myRandomUniform() * yRange,
			                                               [], i, myRandomDispo(), false, myRandomUniform()]));
			break;
		case "Cluster":
			for (let i = 0; i < clusterIterationCount; i++) {
				//record closest points
				let closestPoints = {};
				for (let c = 0; c < candidate_data.length; c++) { closestPoints[c] = []; }
				for (let v = 0; v < voter_data.length; v++) {
					let closestID;
					let minDistance = 9999999;
					for (let c = 0; c < candidate_data.length; c++) {
						let dx = voter_data[v][0] - candidate_data[c][0];
						let dy = voter_data[v][1] - candidate_data[c][1];
						let d = Math.sqrt(dx * dx + dy * dy);
						if (d < minDistance) { minDistance = d; closestID = c; }
					}
					closestPoints[closestID].push(v);
				}
				//move candidates to centroid
				for (let c = 0; c < candidate_data.length; c++) {
					if (closestPoints[c].length == 0) {continue;}
					let centroid = [0,0];
					for (let v = 0; v < closestPoints[c].length; v++) {
						centroid[0] += voter_data[closestPoints[c][v]][0];
						centroid[1] += voter_data[closestPoints[c][v]][1];
					}
					candidate_data[c][0] = centroid[0] / closestPoints[c].length;
					candidate_data[c][1] = centroid[1] / closestPoints[c].length;
				}
			}
			break;
		case "Party-Cluster":
			for (let i = 0; i < clusterIterationCount; i++) {
				//record closest points
				let closestPoints = {};
				for (let c = 0; c < candidate_data.length; c++) { closestPoints[c] = []; }
				for (let v = 0; v < voter_data.length; v++) {
					let closestID;
					let minDistance = 9999999;
					for (let c = 0; c < 2; c++) { //but only for A & B
						let dx = voter_data[v][0] - candidate_data[c][0];
						let dy = voter_data[v][1] - candidate_data[c][1];
						let d = Math.sqrt(dx * dx + dy * dy);
						if (d < minDistance) { minDistance = d; closestID = c; }
					}
					closestPoints[closestID].push(v);
				}
				//move A & B only to centroids
				for (let c = 0; c < 2; c++) {
					if (closestPoints[c].length == 0) {continue;}
					let centroid = [0,0];
					for (let v = 0; v < closestPoints[c].length; v++) {
						centroid[0] += voter_data[closestPoints[c][v]][0];
						centroid[1] += voter_data[closestPoints[c][v]][1];
					}
					candidate_data[c][0] = centroid[0] / closestPoints[c].length;
					candidate_data[c][1] = centroid[1] / closestPoints[c].length;
				}
				/*
				//now get global closest points, including A&B again
				for (let v = 0; v < voter_data.length; v++) {
					let closestID;
					let minDistance = 9999999;
					for (let c = 0; c < candidate_data.length; c++) {
						let dx = voter_data[v][0] - candidate_data[c][0];
						let dy = voter_data[v][1] - candidate_data[c][1];
						let d = Math.sqrt(dx * dx + dy * dy);
						if (d < minDistance) { minDistance = d; closestID = c; }
					}
					closestPoints[closestID].push(v);
				}
				//move all but A & B, fighting over scraps
				for (c = 2; c < candidate_data.length; c++) {
					if (closestPoints[c].length == 0) {continue;}
					let centroid = [0,0];
					for (let v = 0; v < closestPoints[c].length; v++) {
						centroid[0] += voter_data[closestPoints[c][v]][0];
						centroid[1] += voter_data[closestPoints[c][v]][1];
					}
					candidate_data[c][0] = centroid[0] / closestPoints[c].length;
					candidate_data[c][1] = centroid[1] / closestPoints[c].length;
				}
				*/
			}
			//to add insult to injury, make sure A & B dispo is no greater than 4
			candidate_data[0][4] = Math.min(candidate_data[0][4], 4);
			candidate_data[1][4] = Math.min(candidate_data[1][4], 4);
			break;
		case "Add":
			if (candidateCount >= MAX_CANDIDATES) { return; }
			candidate_data.push([myRandomUniform(),
			                     myRandomUniform(),
			                     [], candidateCount, myRandomDispo(), false, myRandomUniform()]);
			candidateCount++;
			break;
		case "Remove":
			if (candidateCount <= 2) { return; }
			candidate_data.pop();
			candidateCount--;
			break;
		default:
	}
	return candidate_data;
}

export function measureVoterDistancesAll(voter_data, candidate_data) {
	let candidateCount = candidate_data.length;
	for (let i = 0; i < voter_data.length; i++) {
		if (voter_data[i][2].length != candidateCount) { voter_data[i][2] = new Array(candidateCount); }
		for (let j = 0; j < candidateCount; j++) {
			let dx = voter_data[i][0] - candidate_data[j][0];
			let dy = voter_data[i][1] - candidate_data[j][1];
			let dz = 0; //candidate_data[j][6];
			voter_data[i][2][j] = Math.sqrt(dx * dx + dy * dy + dz * dz);
		}
	}
	for (let i = 0; i < candidateCount; i++) {
		if (candidate_data[i][2].length != candidateCount) { candidate_data[i][2] = new Array(candidateCount); }
		for (let j = 0; j < candidateCount; j++) {
			let dx = candidate_data[i][0] - candidate_data[j][0];
			let dy = candidate_data[i][1] - candidate_data[j][1];
			let dz = 0; //candidate_data[i][6] - candidate_data[i][6];
			candidate_data[i][2][j] = Math.sqrt(dx * dx + dy * dy + dz * dz);
		}
	}
}

export function measureVoterDistance(voter_data, candidate_data, candidateIndex) {
	for (let i = 0; i < voter_data.length; i++) {
		let dx = voter_data[i][0] - candidate_data[candidateIndex][0];
		let dy = voter_data[i][1] - candidate_data[candidateIndex][1];
		let dz = 0; //candidate_data[candidateIndex][6];
		voter_data[i][2][candidateIndex] = Math.sqrt(dx * dx + dy * dy + dz * dz);
	}
	for (let i = 0; i < candidate_data.length; i++) {
		if (i == candidateIndex) { break; }
		let dx = candidate_data[i][0] - candidate_data[candidateIndex][0];
		let dy = candidate_data[i][1] - candidate_data[candidateIndex][1];
		let dz = 0; //candidate_data[candidateIndex][6];
		candidate_data[i][2][candidateIndex] = Math.sqrt(dx * dx + dy * dy + dz * dz);
	}
}
export function calculateVoterRanks(voter_data) {
	for (let i = 0; i < voter_data.length; i++) {
		let distances = voter_data[i][2];
		voter_data[i][3] = Array.from(Array(distances.length).keys())
			.sort((a, b) => distances[a] > distances[b] ? 1 : -1);
	}
}
const SQRT_3 = Math.sqrt(3);
export function applyDispo(normalizedDistance, dispo) {
	return normalizedDistance ** (SQRT_3 ** (dispo-5));
}
