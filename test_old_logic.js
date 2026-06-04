function oldLogic(strategy, longS_len, longB_len, shortS_len, shortB_len) {
    let validLongS = longS_len >= 5;
    let validLongB = longB_len >= 5;
    let validShortS = shortS_len >= 5;
    let validShortB = shortB_len >= 5;

    let validS = strategy === 'long_short' ? (validLongS && validShortS) : validLongS;
    let validB = strategy === 'long_short' ? (validLongB && validShortB) : validLongB;
    
    return { validS, validB };
}

// User selects LONG: Big, SHORT: Small
console.log("Big - Small:", oldLogic('long_short', 0, 100, 100, 0));

// User selects LONG: Value, SHORT: Growth
console.log("Value - Growth:", oldLogic('long_short', 100, 100, 100, 100));
