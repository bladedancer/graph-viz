import chroma from 'chroma-js';

function color(index, domain) {
    return chroma(chroma.scale('Spectral').colors(domain)[index])
        .darken()
        .hex();
}

export const fetchGraph = async (rootUrl, accessToken, mode) => {
    let entities = new Map();
    await fetchNode(entities, rootUrl, accessToken, mode);
    return Array.from(entities.values());
    
}

const fetchNode = async (entities, url, accessToken, mode) => {
    const response = await fetch(url, {
        method: 'GET',    
        headers: {
            'Authorization': 'Bearer ' + accessToken,
            'Env-Mode': mode
        }
    });

    if (!response.ok) {
        console.error(response);
        return;
    }

    const data = await response.json();
    const wasListUrl = Array.isArray(data.data);
    const dataArray = wasListUrl ? data.data : [data.data];

    for (const item of dataArray) {
        entities.set(item.type + "-" + item.id, item);
        console.log(item);
        // Chase relationships
        if (item.relationships) {
            for (const key in item.relationships) {
                if (!item.relationships[key].data) {
                    continue;
                }

                const relatedDataArray = Array.isArray(item.relationships[key].data) ? 
                    item.relationships[key].data : 
                    [item.relationships[key].data];

                for (const related of relatedDataArray) {
                    if (!entities.has(related.type + "-" + related.id)) {
                        let relatedUrl = url;
                        if (wasListUrl) {
                            // need to add the id
                            relatedUrl += "/" + item.id + "/" + key + "/" + related.id;
                        } else {
                            relatedUrl += "/" + key + "/" + related.id;
                        }
                        await fetchNode(entities, relatedUrl, accessToken, mode);
                    }
                }
            }
        }
    }
}

const linkRelated = (item, col) => {
    const relatedLinks = [];

    if (item.relationships) {
        for (const key in item.relationships) {
            if (!item.relationships[key].data) {
                continue;
            }

            const relatedDataArray = Array.isArray(item.relationships[key].data) ? 
                item.relationships[key].data : 
                [item.relationships[key].data];

            for (const related of relatedDataArray) {
                relatedLinks.push({
                        source: item.type + "-" + item.id,
                        target: related.type + "-" + related.id,
                        size: 1,
                        type: 'arrow',
                        color: chroma(col).alpha(0.5).hex(),
                        weight: 10,
                        cardinality: '1',
                    });
            }
        }
    }
    return relatedLinks;
}

const getGroup = (entity, entityMap) => {
    if (entity.type === "project" || entity.type === "application" || entity.type === "idp" || entity.type === "onpremdataplane") {
        return entity.id;
    } else if (entity.relationships && entity.relationships["application"] && entity.relationships["application"].data) {
        return entityMap.get(entity.relationships["application"].data.type + "-" + entity.relationships["application"].data.id).id;
    } else if (entity.attributes["projectId"]) {
        return entity.attributes["projectId"];
    } else if (entity.relationships && entity.relationships["apiproxy"] && entity.relationships["apiproxy"].data) {
        return entityMap.get(entity.relationships["apiproxy"].data.type + "-" + entity.relationships["apiproxy"].data.id).attributes.projectId;
    } else if (entity.relationships && entity.relationships["apiProxy"] && entity.relationships["apiProxy"].data) {
        return entityMap.get(entity.relationships["apiProxy"].data.type + "-" + entity.relationships["apiProxy"].data.id).attributes.projectId;
    } else {
        return entity.type;
    }
}

const isRoot = (entity) => {
    return entity.type === "project" 
        || entity.type === "application"
        || entity.type === "activation"
        || entity.type === "apikeyauthrule"
        || entity.type === "authrule"
        || entity.type === "oauthrule"
        || entity.type === "transportsecurity"
        || entity.type === "onpremdataplane"
        || entity.type === "idp";
}

const entityName = (entity) => {
    if (entity.attributes.name) {
        return entity.attributes.name;
    } if (entity.type === "operation") {
        return entity.attributes.operationId;
    } else {
        return entity.id;
    }
}


const nodifyEntity = (entity, entityMap, groupIndex) => {
    const group = getGroup(entity, entityMap);

    const node = {
        id: entity.type + "-" + entity.id,
        group: group,
        type: entity.type,
        name: `(${entity.type}) ${entityName(entity)}`,
        isRoot: isRoot(entity),
        raw: entity,
        links: [],
        color: color(groupIndex[group], groupIndex["__last__"] + 1),
    };

    node.links = linkRelated(entity, node.color);
    
    return node;
};

export const nodify = async (entities) => {
    let entityNodes = [];
    let entityMap = new Map();

    entities.forEach(entity => {
        entityMap.set(entity.type + "-" + entity.id, entity);
    });

    let groupIndex = entities.reduce((acc, entity) => {
        const group = getGroup(entity, entityMap);
        if (acc[group] === undefined) {
            acc[group] = acc["__last__"] + 1;
            acc["__last__"] = acc[group];
        }
        return acc;
    }, {"__last__": -1});

    console.log(groupIndex);

    for (const entity of entities) {
        entityNodes.push(nodifyEntity(entity, entityMap, groupIndex));
    }
    return entityNodes;
};
