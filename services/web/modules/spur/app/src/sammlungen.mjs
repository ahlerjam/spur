import { getCollectionInternal } from '../../../../app/src/infrastructure/mongodb.mjs'

export const quellen = () => getCollectionInternal('spurSources')
export const quellenSeiten = () => getCollectionInternal('spurSourcePages')
export const crossrefCache = () => getCollectionInternal('spurCrossref')
export const pruefCache = () => getCollectionInternal('spurCheckSections')
export const klone = () => getCollectionInternal('spurClones')
export const quotes = () => getCollectionInternal('spurQuotes')
export const ereignisse = () => getCollectionInternal('spurEvents')
export const herzschlaege = () => getCollectionInternal('spurHeartbeats')
export const nachrichten = () => getCollectionInternal('spurMessages')
