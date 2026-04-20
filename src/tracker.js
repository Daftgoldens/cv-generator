'use strict';
const { createClient } = require('@supabase/supabase-js');

function getClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );
}

// --- Applications ---

async function listApplications() {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function createApplication(fields) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('applications')
    .insert(fields)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateApplication(id, fields) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('applications')
    .update(fields)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteApplication(id) {
  const supabase = getClient();
  const { error } = await supabase
    .from('applications')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// --- Pipeline ---

async function listPipeline() {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('pipeline')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function createPipelineItem(fields) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('pipeline')
    .insert(fields)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updatePipelineItem(id, fields) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('pipeline')
    .update(fields)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deletePipelineItem(id) {
  const supabase = getClient();
  const { error } = await supabase
    .from('pipeline')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

module.exports = {
  listApplications, createApplication, updateApplication, deleteApplication,
  listPipeline, createPipelineItem, updatePipelineItem, deletePipelineItem,
};
